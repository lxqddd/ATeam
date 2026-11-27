/**
 * The provider/model configuration store lives in `@ateam/agent-core` so the
 * desktop app, headless CLI, and future entry points read and write the same
 * `userData/models/config.json` document. This module keeps the desktop import
 * path stable.
 */
export { ModelConfigStore } from '@ateam/agent-core'
