/* Checked-in bindings for cpp/include/mnn_wrapper.h.
 *
 * The wrapper ABI is intentionally small and stable. Keeping these declarations
 * in source avoids requiring libclang on every contributor and release machine.
 */

pub enum MNN_InferenceEngine {}
pub enum MNN_SessionPool {}
pub enum MNN_SharedRuntime {}

pub type MNNR_ErrorCode = ::std::os::raw::c_uint;
pub const MNNR_ErrorCode_MNNR_SUCCESS: MNNR_ErrorCode = 0;
pub const MNNR_ErrorCode_MNNR_ERROR_INVALID_PARAMETER: MNNR_ErrorCode = 1;
pub const MNNR_ErrorCode_MNNR_ERROR_OUT_OF_MEMORY: MNNR_ErrorCode = 2;
pub const MNNR_ErrorCode_MNNR_ERROR_RUNTIME_ERROR: MNNR_ErrorCode = 3;
pub const MNNR_ErrorCode_MNNR_ERROR_UNSUPPORTED: MNNR_ErrorCode = 4;
pub const MNNR_ErrorCode_MNNR_ERROR_MODEL_LOAD_FAILED: MNNR_ErrorCode = 5;

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct MNNR_Config {
    pub thread_count: i32,
    pub precision_mode: i32,
    pub use_cache: bool,
    pub data_format: i32,
    pub forward_type: i32,
}

extern "C" {
    pub fn mnnr_get_version() -> *const ::std::os::raw::c_char;
    pub fn mnnr_is_backend_available(forward_type: i32) -> bool;
    pub fn mnnr_create_runtime(config: *const MNNR_Config) -> *mut MNN_SharedRuntime;
    pub fn mnnr_destroy_runtime(runtime: *mut MNN_SharedRuntime);
    pub fn mnnr_create_engine(
        buffer: *const ::std::os::raw::c_void,
        size: usize,
        config: *const MNNR_Config,
    ) -> *mut MNN_InferenceEngine;
    pub fn mnnr_create_engine_with_runtime(
        buffer: *const ::std::os::raw::c_void,
        size: usize,
        runtime: *mut MNN_SharedRuntime,
    ) -> *mut MNN_InferenceEngine;
    pub fn mnnr_destroy_engine(engine: *mut MNN_InferenceEngine);
    pub fn mnnr_get_input_shape(
        engine: *const MNN_InferenceEngine,
        dims: *mut usize,
        out_ndims: *mut usize,
    ) -> MNNR_ErrorCode;
    pub fn mnnr_get_output_shape(
        engine: *const MNN_InferenceEngine,
        dims: *mut usize,
        out_ndims: *mut usize,
    ) -> MNNR_ErrorCode;
    pub fn mnnr_run_inference(
        engine: *mut MNN_InferenceEngine,
        input_data: *const f32,
        input_size: usize,
        output_data: *mut f32,
        output_size: usize,
    ) -> MNNR_ErrorCode;
    pub fn mnnr_get_last_error(engine: *const MNN_InferenceEngine)
        -> *const ::std::os::raw::c_char;
    pub fn mnnr_create_session_pool(
        engine: *mut MNN_InferenceEngine,
        pool_size: usize,
        config: *const MNNR_Config,
    ) -> *mut MNN_SessionPool;
    pub fn mnnr_destroy_session_pool(pool: *mut MNN_SessionPool);
    pub fn mnnr_session_pool_run(
        pool: *mut MNN_SessionPool,
        input_data: *const f32,
        input_size: usize,
        output_data: *mut f32,
        output_size: usize,
    ) -> MNNR_ErrorCode;
    pub fn mnnr_session_pool_available(pool: *const MNN_SessionPool) -> usize;
    pub fn mnnr_run_inference_dynamic(
        engine: *mut MNN_InferenceEngine,
        input_data: *const f32,
        input_dims: *const usize,
        input_ndims: usize,
        output_data: *mut *mut f32,
        output_size: *mut usize,
        output_dims: *mut usize,
        output_ndims: *mut usize,
    ) -> MNNR_ErrorCode;
    pub fn mnnr_free_output(output_data: *mut f32);
}
