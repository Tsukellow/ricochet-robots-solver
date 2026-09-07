import { solve } from "./engine.js";
self.onmessage = ({ data }) => {
    try {
        const result = solve(data.board, {
            ...data.options,
            onProgress: (progress) =>
                self.postMessage({ type: "progress", progress }),
        });
        self.postMessage({ type: "result", result });
    } catch (error) {
        self.postMessage({ type: "error", message: error.message });
    }
};
