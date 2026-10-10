import { createRouteHandler } from '@gaussian/meridian-next'

export const { POST } = createRouteHandler({ authorize: () => true })
