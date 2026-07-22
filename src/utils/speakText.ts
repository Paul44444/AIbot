export async function speakText(
    text: string,
    onStart: () => void,
    onEnd: () => void
) {

    console.time("tts fetch");
    const response = await fetch("/api/tts", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
    });
    console.timeEnd("tts fetch");

    if (!response.ok) {
        throw new Error(
            `TTS error ${response.status}: ${await response.text()}`
        );
    }

    console.time("tts blob");
    const audioBlob = await response.blob();
    console.timeEnd("tts blob");


    const audioUrl =
        URL.createObjectURL(audioBlob);

    const audio =
        new Audio(audioUrl);

    audio.onplay = onStart;

    audio.onended = () => {

        onEnd();

        URL.revokeObjectURL(audioUrl);
    };

    console.time("audio play");
    await audio.play();
    console.timeEnd("audio play");


}