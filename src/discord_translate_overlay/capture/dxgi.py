from __future__ import annotations

import logging
import threading
import time

import numpy as np
import win32api

from ..models import Rect

LOGGER = logging.getLogger("discord_translate_overlay")
DXGI_RETRY_SECONDS = 30.0


class DxgiCapture:
    """Low-latency DXGI Desktop Duplication capture with region support."""

    def __init__(self) -> None:
        try:
            import dxcam
        except ImportError as exc:
            raise RuntimeError("dxcam is required for live capture") from exc
        self._dxcam = dxcam
        self._camera = None
        self._cameras: dict[int, object] = {}
        self._output_index: int | None = None
        self._outputs = self._enumerate_outputs()
        self._lock = threading.Lock()
        self._fallback_until = 0.0
        self._using_fallback = False

    def capture(self, region: Rect) -> np.ndarray | None:
        with self._lock:
            if region.area == 0:
                return None
            if time.monotonic() < getattr(self, "_fallback_until", 0.0):
                return self._fallback_capture(region)
            try:
                try:
                    frame = self._capture_dxgi(region)
                except ValueError:
                    # Display topology and duplication sessions can change while a
                    # Discord window is moving between outputs. Refresh every output
                    # and retry the complete (possibly stitched) frame once.
                    self._release_cameras()
                    self._outputs = self._enumerate_outputs()
                    frame = self._capture_dxgi(region)
            except Exception as exc:
                # DXGI raises COM/runtime errors (not ValueError) when a GPU is
                # reset, suspended or its driver is restarted. The duplication
                # object remains poisoned, so stop retrying it every timer tick.
                self._release_cameras()
                if not getattr(self, "_using_fallback", False):
                    LOGGER.warning(
                        "DXGI device/session failed (%s); using local screen fallback.",
                        exc,
                    )
                self._using_fallback = True
                self._fallback_until = time.monotonic() + DXGI_RETRY_SECONDS
                return self._fallback_capture(region)
            if frame is None:
                if not getattr(self, "_using_fallback", False):
                    LOGGER.warning(
                        "DXGI returned no frame after recovery; using local screen fallback."
                    )
                self._using_fallback = True
                self._fallback_until = time.monotonic() + DXGI_RETRY_SECONDS
                return self._fallback_capture(region)
            if getattr(self, "_using_fallback", False):
                LOGGER.info("DXGI capture recovered; leaving local screen fallback.")
                self._using_fallback = False
                self._fallback_until = 0.0
            return None if frame is None else np.ascontiguousarray(frame)

    def _capture_dxgi(self, region: Rect) -> np.ndarray | None:
        intersections = self._intersections(region)
        if not intersections:
            return None

        # Desktop Duplication is output-scoped. A window straddling two monitors
        # must therefore be captured in pieces and reassembled in the original
        # virtual-desktop coordinate space.
        frame = np.zeros((region.height, region.width, 3), dtype=np.uint8)
        for output_index, output, visible in intersections:
            local = visible.translated(-output.left, -output.top)
            piece = self._grab_output(output_index, output, local)
            if piece is None:
                return None
            expected_shape = (visible.height, visible.width)
            if piece.shape[:2] != expected_shape:
                LOGGER.warning(
                    "DXGI output %d returned %s for requested %s",
                    output_index,
                    piece.shape[:2],
                    expected_shape,
                )
                return None
            target_left = visible.left - region.left
            target_top = visible.top - region.top
            frame[
                target_top : target_top + visible.height,
                target_left : target_left + visible.width,
            ] = piece[:, :, :3]
        return frame

    def _grab_output(self, output_index: int, output: Rect, region: Rect):
        camera = self._camera_for(output_index, output)
        try:
            frame = camera.grab(
                region=(region.left, region.top, region.right, region.bottom),
                new_frame_only=False,
            )
        except ValueError:
            self._recreate_camera(output_index)
            raise
        if frame is not None:
            return frame

        # A cached Desktop Duplication session can stop producing frames after
        # sleep, display reconfiguration, or moving between GPUs. Recreate only
        # that output once instead of disturbing the other monitor cameras.
        camera = self._recreate_camera(output_index)
        try:
            return camera.grab(
                region=(region.left, region.top, region.right, region.bottom),
                new_frame_only=False,
            )
        except ValueError:
            return None

    @staticmethod
    def _fallback_capture(region: Rect) -> np.ndarray:
        from PIL import ImageGrab

        image = ImageGrab.grab(
            bbox=(region.left, region.top, region.right, region.bottom),
            all_screens=True,
        )
        rgb = np.asarray(image)
        return np.ascontiguousarray(rgb[:, :, :3][:, :, ::-1])

    def _resolve_region(self, region: Rect) -> tuple[int, Rect, Rect]:
        # dxcam maps virtual-desktop coordinates through the output owning the point.
        output_index = self._output_for(region.left, region.top)
        output = self._outputs[output_index]
        return output_index, output, self._to_output_local(region, output)

    def _camera_for(self, output_index: int, output: Rect):
        cameras = self._camera_cache()
        camera = cameras.get(output_index)
        if camera is None or not _camera_matches_output(camera, output):
            camera = self._recreate_camera(output_index)
        self._camera = camera
        self._output_index = output_index
        return camera

    def _camera_cache(self) -> dict[int, object]:
        cameras = getattr(self, "_cameras", None)
        if cameras is None:
            cameras = {}
            legacy = getattr(self, "_camera", None)
            legacy_index = getattr(self, "_output_index", None)
            if legacy is not None and legacy_index is not None:
                cameras[legacy_index] = legacy
            self._cameras = cameras
        return cameras

    def _recreate_camera(self, output_index: int):
        cameras = self._camera_cache()
        previous = cameras.pop(output_index, None)
        if previous is not None:
            try:
                previous.release()
            except Exception:
                LOGGER.debug("Ignoring DXGI release failure during recovery.", exc_info=True)
        camera = self._dxcam.create(output_idx=output_index, output_color="BGR")
        cameras[output_index] = camera
        self._camera = camera
        self._output_index = output_index
        return camera

    def _grab(self, region: Rect):
        return self._camera.grab(
            region=(region.left, region.top, region.right, region.bottom),
            new_frame_only=False,
        )

    def close(self) -> None:
        with self._lock:
            self._release_cameras()

    def _release_cameras(self) -> None:
        cameras = self._camera_cache()
        released: set[int] = set()
        for camera in cameras.values():
            identity = id(camera)
            if identity in released:
                continue
            try:
                camera.release()
            except Exception:
                LOGGER.debug("Ignoring DXGI release failure.", exc_info=True)
            released.add(identity)
        cameras.clear()
        self._camera = None
        self._output_index = None

    def _intersections(self, region: Rect) -> list[tuple[int, Rect, Rect]]:
        intersections: list[tuple[int, Rect, Rect]] = []
        for index, output in enumerate(self._outputs):
            visible = Rect(
                max(region.left, output.left),
                max(region.top, output.top),
                min(region.right, output.right),
                min(region.bottom, output.bottom),
            )
            if visible.area:
                intersections.append((index, output, visible))
        return intersections

    def _output_for(self, x: int, y: int) -> int:
        for index, rect in enumerate(self._outputs):
            if rect.left <= x < rect.right and rect.top <= y < rect.bottom:
                return index
        return 0

    @staticmethod
    def _to_output_local(region: Rect, output: Rect) -> Rect:
        clipped = Rect(
            max(region.left, output.left),
            max(region.top, output.top),
            min(region.right, output.right),
            min(region.bottom, output.bottom),
        )
        return clipped.translated(-output.left, -output.top)

    def _enumerate_outputs(self) -> list[Rect]:
        """Map dxcam output order to Win32 virtual-desktop coordinates."""
        monitors: dict[str, Rect] = {}
        for monitor, _, _ in win32api.EnumDisplayMonitors():
            info = win32api.GetMonitorInfo(monitor)
            monitors[str(info["Device"])] = Rect(*info["Monitor"])
        output_names = list(self._dxcam.get_output_metadata())
        outputs = [monitors[name] for name in output_names if name in monitors]
        if not outputs:
            raise RuntimeError("Windows 디스플레이 출력을 찾지 못했어.")
        return outputs


def _camera_matches_output(camera, output: Rect) -> bool:
    return camera.width == output.width and camera.height == output.height
