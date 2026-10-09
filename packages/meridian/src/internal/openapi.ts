/** The JSON body of an OpenAPI request body or response. */
export type JsonBody<T> = T extends { content: { 'application/json': infer B } } ? B : never

/** The server-sent-events body of an OpenAPI response (one event). */
export type EventBody<T> = T extends { content: { 'text/event-stream': infer B } } ? B : never

type Success<R> = R extends { 200: infer A } ? A : R extends { 201: infer B } ? B : never

export type RequestBody<Op> = Op extends { requestBody?: infer R } ? JsonBody<NonNullable<R>> : never
export type OkBody<Op> = Op extends { responses: infer R } ? JsonBody<Success<R>> : never
export type OkEvent<Op> = Op extends { responses: infer R } ? EventBody<Success<R>> : never
