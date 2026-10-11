import type { ClientModule, JsonValue } from 'claude-code'

/**
 * An invisible layer laid over part of the pane: a left click anywhere on it
 * posts `msg` to the hooks module (open a session, fold COMPLETED).
 */
const ClickLayer: ClientModule<{ msg: JsonValue }> = (props, surface) => {
  surface.onPointer(e => {
    if (e.type === 'up' && (e.button ?? 'left') === 'left') surface.post(props.msg)
  })
  return surface.elements.Box({ width: '100%', height: '100%' })
}

export default ClickLayer
