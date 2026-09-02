import { handleJsonProxy } from "./jsonProxy.js";

export const handleModerations = (request) => handleJsonProxy(request, "moderation");
