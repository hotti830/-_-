/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Upload, 
  Image as ImageIcon, 
  Maximize2, 
  Eraser, 
  Download, 
  Loader2, 
  X,
  CheckCircle2,
  AlertCircle,
  Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Extend window for AI Studio API key selection
declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

type UpscaleFactor = 2 | 4 | 6 | 8;

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [upscaledImage, setUpscaledImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [upscaleFactor, setUpscaleFactor] = useState<UpscaleFactor>(2);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Check for API key on mount
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
      } else {
        // Fallback for local dev if not in AI Studio environment
        setHasKey(true);
      }
    };
    checkKey();
  }, []);

  const handleOpenKeySelector = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasKey(true);
    }
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('이미지 파일만 업로드 가능합니다.');
      return;
    }
    setError(null);
    setOriginalFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setImage(e.target?.result as string);
    reader.readAsDataURL(file);
    setUpscaledImage(null);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const handleUpscale = async () => {
    if (!image) return;
    setIsProcessing(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      
      // Map upscale factor to Gemini imageSize
      // 2x -> 1K, 4x -> 2K, 8x -> 4K
      let imageSize: "1K" | "2K" | "4K" = "1K";
      if (upscaleFactor === 4) imageSize = "2K";
      if (upscaleFactor >= 6) imageSize = "4K";

      const base64Data = image.split(',')[1];
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: originalFile?.type || 'image/png',
              },
            },
            {
              text: `Upscale this image by ${upscaleFactor}x. Maintain all original details perfectly but make it much sharper and higher resolution. The output should be a high-quality version of the input image.`,
            },
          ],
        },
        config: {
          imageConfig: {
            imageSize: imageSize,
            aspectRatio: "1:1", // We'll try to maintain original, but Gemini 3.1 requires one of the supported ones
          }
        }
      });

      let foundImage = false;
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            setUpscaledImage(`data:image/png;base64,${part.inlineData.data}`);
            foundImage = true;
            break;
          }
        }
      }

      if (!foundImage) {
        throw new Error('이미지를 생성하지 못했습니다. 다시 시도해주세요.');
      }
    } catch (err: any) {
      console.error(err);
      if (err.message?.includes("Requested entity was not found")) {
        setHasKey(false);
        setError("API 키가 만료되었거나 올바르지 않습니다. 다시 선택해주세요.");
      } else {
        setError('업스케일링 중 오류가 발생했습니다: ' + (err.message || '알 수 없는 오류'));
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const removeWhiteBackground = () => {
    const currentImage = upscaledImage || image;
    if (!currentImage) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Iterate through pixels and remove white-ish colors
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // Threshold for "white"
        if (r > 240 && g > 240 && b > 240) {
          data[i + 3] = 0; // Set alpha to 0
        }
      }

      ctx.putImageData(imageData, 0, 0);
      setUpscaledImage(canvas.toDataURL('image/png'));
    };
    img.src = currentImage;
  };

  const downloadImage = () => {
    const link = document.createElement('a');
    link.href = upscaledImage || image || '';
    link.download = `upscaled_${upscaleFactor}x.png`;
    link.click();
  };

  if (hasKey === false) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-3xl p-8 shadow-xl border border-zinc-200 text-center"
        >
          <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Key className="text-indigo-600 w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 mb-4">API 키가 필요합니다</h1>
          <p className="text-zinc-600 mb-8 leading-relaxed">
            이미지 업스케일링 기능을 사용하려면 Gemini API 키를 선택해야 합니다. 
            유료 Google Cloud 프로젝트의 키가 필요할 수 있습니다.
          </p>
          <button
            onClick={handleOpenKeySelector}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-semibold transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
          >
            <Key size={20} />
            API 키 선택하기
          </button>
          <p className="mt-4 text-xs text-zinc-400">
            <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="underline">
              결제 및 API 키 안내 보기
            </a>
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans p-4 md:p-8">
      <canvas ref={canvasRef} className="hidden" />
      
      <div className="max-w-5xl mx-auto">
        <header className="mb-12 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 bg-indigo-50 text-indigo-600 rounded-full text-sm font-medium mb-4"
          >
            <Maximize2 size={16} />
            AI Image Enhancer
          </motion.div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-zinc-900 mb-4">
            AI 이미지 업스케일러
          </h1>
          <p className="text-zinc-500 max-w-2xl mx-auto text-lg">
            저해상도 이미지를 AI로 선명하게 변환하고, 배경을 제거하여 투명한 PNG로 추출하세요.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Upload & Preview */}
          <div className="lg:col-span-7 space-y-6">
            {!image ? (
              <motion.div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                whileHover={{ scale: 1.01 }}
                className={`relative h-[400px] border-2 border-dashed rounded-3xl flex flex-col items-center justify-center transition-all cursor-pointer bg-white ${
                  isDragging ? 'border-indigo-500 bg-indigo-50/50' : 'border-zinc-200 hover:border-zinc-300'
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                  className="hidden"
                  accept="image/*"
                />
                <div className="w-20 h-20 bg-zinc-50 rounded-full flex items-center justify-center mb-6">
                  <Upload className="text-zinc-400 w-10 h-10" />
                </div>
                <h3 className="text-xl font-semibold mb-2">이미지를 드래그하거나 클릭하세요</h3>
                <p className="text-zinc-400">JPG, PNG, WebP 지원</p>
              </motion.div>
            ) : (
              <div className="relative bg-white rounded-3xl p-4 shadow-sm border border-zinc-200 overflow-hidden group">
                <div className="aspect-square w-full relative rounded-2xl overflow-hidden bg-zinc-100 flex items-center justify-center">
                  <img 
                    src={upscaledImage || image} 
                    alt="Preview" 
                    className="max-w-full max-h-full object-contain"
                  />
                  {isProcessing && (
                    <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center">
                      <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
                      <p className="font-medium text-zinc-900">AI가 이미지를 분석하고 있습니다...</p>
                      <p className="text-zinc-500 text-sm">잠시만 기다려주세요</p>
                    </div>
                  )}
                </div>
                <button 
                  onClick={() => { setImage(null); setUpscaledImage(null); }}
                  className="absolute top-6 right-6 p-2 bg-white/90 hover:bg-white text-zinc-900 rounded-full shadow-lg transition-all"
                >
                  <X size={20} />
                </button>
                <div className="mt-4 flex items-center justify-between text-sm text-zinc-500 px-2">
                  <div className="flex items-center gap-2">
                    <ImageIcon size={16} />
                    <span>{originalFile?.name}</span>
                  </div>
                  {upscaledImage && (
                    <div className="flex items-center gap-1 text-emerald-600 font-medium">
                      <CheckCircle2 size={16} />
                      <span>업스케일 완료</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Controls */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-zinc-200">
              <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                <Maximize2 size={20} className="text-indigo-600" />
                업스케일 설정
              </h3>
              
              <div className="space-y-6">
                <div>
                  <label className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4 block">
                    배율 선택
                  </label>
                  <div className="grid grid-cols-4 gap-3">
                    {([2, 4, 6, 8] as UpscaleFactor[]).map((factor) => (
                      <button
                        key={factor}
                        onClick={() => setUpscaleFactor(factor)}
                        className={`py-3 rounded-2xl font-bold transition-all border-2 ${
                          upscaleFactor === factor
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100'
                            : 'bg-white border-zinc-100 text-zinc-500 hover:border-zinc-200'
                        }`}
                      >
                        {factor}x
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-4 space-y-3">
                  <button
                    disabled={!image || isProcessing}
                    onClick={handleUpscale}
                    className="w-full py-4 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-200 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
                  >
                    {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Maximize2 size={20} />}
                    AI 업스케일링 시작
                  </button>

                  <button
                    disabled={!image || isProcessing}
                    onClick={removeWhiteBackground}
                    className="w-full py-4 bg-white border-2 border-zinc-100 hover:border-zinc-200 disabled:opacity-50 text-zinc-900 rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
                  >
                    <Eraser size={20} className="text-indigo-600" />
                    흰색 배경 제거 (PNG)
                  </button>
                </div>
              </div>

              {error && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-6 p-4 bg-red-50 text-red-600 rounded-2xl text-sm flex items-start gap-3"
                >
                  <AlertCircle size={18} className="shrink-0 mt-0.5" />
                  <p>{error}</p>
                </motion.div>
              )}
            </div>

            {upscaledImage && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-indigo-600 rounded-3xl p-8 text-white shadow-xl shadow-indigo-100"
              >
                <h3 className="text-lg font-bold mb-2">결과물이 준비되었습니다!</h3>
                <p className="text-indigo-100 text-sm mb-6">고해상도로 변환된 이미지를 다운로드하세요.</p>
                <button
                  onClick={downloadImage}
                  className="w-full py-4 bg-white text-indigo-600 hover:bg-zinc-50 rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
                >
                  <Download size={20} />
                  이미지 다운로드
                </button>
              </motion.div>
            )}
          </div>
        </div>

        <footer className="mt-16 text-center text-zinc-400 text-sm">
          <p>© 2026 AI Image Studio. Powered by Gemini 3.1 Flash Image.</p>
        </footer>
      </div>
    </div>
  );
}
