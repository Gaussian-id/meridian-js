import { createRouteHandler } from 'meridian-next'

export const { POST } = createRouteHandler({ authorize: () => true })
