import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
    api: {
        bodyParser: false,
    },
};

async function readRawBody(req: VercelRequest): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = "";

        req.setEncoding("utf8");

        req.on("data", (chunk) => {
            data += chunk;
        });

        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "POST") {
        return res.status(405).send("Method not allowed");
    }

    const sdp = await readRawBody(req);

    console.log("SDP starts with:", JSON.stringify(sdp.slice(0, 30)));

    if (!sdp.startsWith("v=0")) {
        return res.status(400).send(
            `Invalid SDP received. Starts with: ${JSON.stringify(sdp.slice(0, 30))}`
        );
    }

    const fd = new FormData();

    fd.set("sdp", sdp);

    fd.set("session", JSON.stringify({
        type: "realtime",
        model: "gpt-realtime-2",
        audio: {
            input: {
                transcription: {
                    model: "gpt-4o-mini-transcribe",
                },
            },
            output: {
                voice: "marin",
            },
        },
        instructions: `
You are a cheerful anime-style teenage boy character on this website.
Answer naturally as the character.
Do not say you are an AI model.
Keep answers short and conversational.
        `.trim(),
    }));

    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: fd,
    });

    const answerSdp = await response.text();

    if (!response.ok) {
        return res.status(response.status).send(answerSdp);
    }

    res.setHeader("Content-Type", "application/sdp");
    return res.status(200).send(answerSdp);
}
