import { createClient } from "../packages/meridian/dist/index.js";

// [1] An engine answer, served by an inline fetch: no network
const frames = [
  'data: {"id":"c","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\n',
  "data: [DONE]\n\n",
];

const encoder = new TextEncoder();

const fetchStub = async () =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

// [2] Stream and collect through the built package
const meridian = createClient("http://engine.test", "gmr_smoke", { fetch: fetchStub });

const { data: stream, error } = await meridian.chat.stream({
  messages: [{ role: "user", content: "hi" }],
});

if (error) throw new Error(`stream refused: ${error.code}`);
const text = await stream.text();

if (text.data !== "ok") throw new Error(`unexpected text: ${JSON.stringify(text)}`);
console.log("runtime smoke ok");
