// Structure transcribed from user-provided X/Whale Elements screenshots.
// All text, IDs and routes below are synthetic; no real DM data is retained.
export const X_CHAT_URL = "https://x.com/i/chat/synthetic-conversation";

export function xChatMessage(id, text, outgoing = false) {
  return `<div data-index="0" class="absolute top-0 left-0 w-full">
    <div class="flex min-w-0 flex-col gap-1 ${outgoing ? "items-end" : "items-start"}" style="grid-area: content;">
      <div class="relative" role="article">
        <div class="relative flex ${outgoing ? "justify-end bg-chat-accent" : "bg-chat"} px-4 py-2 rounded-chat" data-testid="message-text-${id}">
          <div><div class="relative inline-flex flex-wrap items-end gap-2 overflow-hidden">
            <div class="font-chirp max-w-full whitespace-pre-wrap break-words text-inherit text-body font-normal">
              <span dir="auto" id="${id}" class="font-chirp whitespace-pre-wrap"><span>${text}</span></span>
              <span aria-hidden="true" class="user-select-none inline-block opacity-0">Hidden timestamp spacer</span>
            </div>
            <div class="absolute bottom-0 inset-e-0"><span>12:34</span></div>
          </div></div>
        </div>
        <div class="absolute top-0 bottom-0"><button>React</button></div>
      </div>
      <div style="grid-area: message-info;"><span>Delivery information</span></div>
    </div>
  </div>`;
}

export const X_CHAT_PANEL = `<div data-testid="dm-conversation-panel">
  <div class="relative flex h-full flex-1">
    <div class="relative flex h-full grow flex-col" data-testid="dm-conversation-content">
      <div class="absolute top-0"><span dir="auto">Synthetic conversation header</span></div>
      <div class="isolate flex-1 overflow-hidden" data-testid="dm-message-list-container">
        <div class="relative h-full" data-testid="dm-message-list">
          <div class="scrollbar-thin-custom h-full w-full overflow-y-auto" tabindex="0" role="log" data-testid="dm-message-scroller" data-virtualizer="tanstack">
            <div style="height:84px"></div>
            <div role="status" data-testid="dm-message-list-spinner-slot">Loading messages</div>
            <div class="relative w-full" style="height:932px">
              ${xChatMessage("body-one", "A neutral incoming message.")}
              ${xChatMessage("body-two", "A neutral outgoing message.", true)}
            </div>
          </div>
        </div>
      </div>
      <div contenteditable="true" role="textbox">Unsent synthetic draft</div><button id="send">Send</button>
    </div>
  </div>
</div>`;

export const X_CHAT = `<main role="main"><div data-testid="primaryColumn">
  <div id="dm-main-container" data-testid="dm-container">
    <div data-testid="dm-inbox-panel"><span dir="auto">Synthetic contact and preview</span></div>
    ${X_CHAT_PANEL}
  </div>
</div></main>`;
