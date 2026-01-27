/**
 * 内置工具 - 图片分析
 */

import { Type } from "@sinclair/typebox";
import type { Tool } from "../types.js";
import { jsonResult, errorResult, readStringParam } from "../common.js";
import { getProvider, findProviderForModel } from "../../providers/index.js";
import type { ProviderId } from "../../types/index.js";
import { readFileSync, existsSync } from "fs";
import { extname } from "path";

/** 图片分析工具选项 */
export interface ImageAnalyzeToolOptions {
  defaultProvider?: ProviderId;
  defaultModel?: string;
}

/** 获取图片的 MIME 类型 */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };
  return mimeTypes[ext] ?? "image/jpeg";
}

/** 图片分析工具 */
export function createImageAnalyzeTool(options?: ImageAnalyzeToolOptions): Tool {
  return {
    name: "image_analyze",
    label: "Image Analyze",
    description: "Analyze an image using a vision-capable model. Can describe content, extract text, identify objects, etc.",
    parameters: Type.Object({
      image: Type.String({ description: "Image source: file path, URL, or base64 data" }),
      prompt: Type.Optional(Type.String({ description: "Question or instruction about the image (default: 'Describe this image')" })),
      provider: Type.Optional(Type.String({ description: "Model provider to use" })),
      model: Type.Optional(Type.String({ description: "Specific model to use" })),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const image = readStringParam(params, "image", { required: true })!;
      const prompt = readStringParam(params, "prompt") ?? "请详细描述这张图片的内容。";
      const providerParam = readStringParam(params, "provider") as ProviderId | undefined;
      const modelParam = readStringParam(params, "model");

      try {
        // 解析图片数据
        let imageData: { url?: string; base64?: string; mediaType?: string };

        if (image.startsWith("http://") || image.startsWith("https://")) {
          // URL
          imageData = { url: image };
        } else if (image.startsWith("data:")) {
          // Data URL
          const match = image.match(/^data:([^;]+);base64,(.+)$/);
          if (!match) {
            return errorResult("Invalid data URL format");
          }
          imageData = { base64: match[2], mediaType: match[1] };
        } else if (existsSync(image)) {
          // 文件路径
          const buffer = readFileSync(image);
          imageData = {
            base64: buffer.toString("base64"),
            mediaType: getMimeType(image),
          };
        } else if (/^[A-Za-z0-9+/=]+$/.test(image) && image.length > 100) {
          // 纯 base64
          imageData = { base64: image, mediaType: "image/jpeg" };
        } else {
          return errorResult("Invalid image source. Provide a URL, file path, or base64 data.");
        }

        // 查找支持视觉的模型
        let provider = providerParam ? getProvider(providerParam) : undefined;
        let model = modelParam;

        if (!provider || !model) {
          // 尝试找到支持视觉的模型
          const visionModels = [
            { provider: "kimi" as ProviderId, model: "kimi-latest" },
            { provider: "minimax" as ProviderId, model: "MiniMax-VL-01" },
            { provider: "stepfun" as ProviderId, model: "step-1v-8k" },
          ];

          for (const vm of visionModels) {
            const p = getProvider(vm.provider);
            if (p) {
              provider = p;
              model = vm.model;
              break;
            }
          }
        }

        if (!provider || !model) {
          return errorResult("No vision-capable model provider available");
        }

        // 构建多模态消息
        const response = await provider.chat({
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image",
                  url: imageData.url,
                  base64: imageData.base64,
                  mediaType: imageData.mediaType,
                },
              ],
            },
          ],
          maxTokens: 2048,
        });

        return jsonResult({
          status: "success",
          provider: provider.id,
          model,
          prompt,
          analysis: response.content,
          usage: response.usage,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
