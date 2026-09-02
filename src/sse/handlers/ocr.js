import { handleJsonProxy } from "./jsonProxy.js";

export const handleOcr = (request) => handleJsonProxy(request, "ocr");
