import { streamChat } from "../../frontend/electron/services/ollama";

async function main() {
    console.log("Testing streamChat to Ollama...");
    try {
        const generator = streamChat([{role: "user", content: "Say 'Hello World'"}]);
        for await (const chunk of generator) {
            process.stdout.write(chunk);
        }
        console.log("\nSuccess!");
    } catch (e) {
        console.error("Error:", e);
    }
}
main();
