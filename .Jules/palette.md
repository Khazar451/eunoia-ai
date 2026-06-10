## 2024-05-20 - Chat Input Focus Management
**Learning:** When inputs are disabled during async operations (like waiting for AI), they lose focus. Users find it frustrating to have to click back into the input field for every single message they want to send.
**Action:** Always programmatically restore focus (`element.focus()`) to the primary input after re-enabling it following an async operation.
