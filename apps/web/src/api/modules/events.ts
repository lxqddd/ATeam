import { openSse, type SseHandle, type SseHandlers } from '../http/sse'

export class EventApi {
  /** Subscribe to the server event stream. Returns a handle to close it. */
  static subscribe(handlers: SseHandlers, path = '/events'): SseHandle {
    return openSse(path, handlers)
  }
}
