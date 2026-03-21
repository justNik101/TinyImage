/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback } from 'react';
import { Upload, Download, Image as ImageIcon, X, Loader2, ArrowRight, Settings2, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ImageStats {
  originalSize: number;
  compressedSize: number;
  originalWidth: number;
  originalHeight: number;
  compressedWidth: number;
  compressedHeight: number;
  quality: number;
}

export default function App() {
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [compressedUrl, setCompressedUrl] = useState<string | null>(null);
  const [targetSizeKB, setTargetSizeKB] = useState<number>(100);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState<ImageStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    setSelectedImage(file);
    setPreviewUrl(URL.createObjectURL(file));
    setCompressedUrl(null);
    setStats(null);
    setError(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      processFile(file);
    }
  };

  const compressImage = async () => {
    if (!selectedImage) return;
    setIsProcessing(true);
    setError(null);

    try {
      const img = new Image();
      img.src = previewUrl!;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const targetSizeBytes = targetSizeKB * 1024;
      let quality = 0.9;
      let scale = 1.0;
      let compressedBlob: Blob | null = null;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Iterative compression strategy
      let attempts = 0;
      const maxAttempts = 30;
      
      // Initial check at high quality
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      compressedBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
      });

      if (compressedBlob && compressedBlob.size > targetSizeBytes) {
        while (attempts < maxAttempts) {
          const sizeRatio = compressedBlob.size / targetSizeBytes;
          
          if (sizeRatio <= 1.0) break;

          // Strategy: 
          // 1. Reduce quality down to 0.1 first
          // 2. Then start reducing scale
          
          if (quality > 0.1) {
            // Reduce quality gradually
            quality -= Math.max(0.05, (quality - 0.1) * 0.3);
            if (quality < 0.1) quality = 0.1;
          } else {
            // Quality is at minimum, now reduce scale
            // Use a more conservative scaling factor to avoid excessive blurring
            scale *= Math.max(0.7, 1 / Math.sqrt(sizeRatio));
          }

          scale = Math.max(scale, 0.05); // Don't go below 5% of original size

          canvas.width = Math.max(1, img.width * scale);
          canvas.height = Math.max(1, img.height * scale);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          compressedBlob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
          });

          if (!compressedBlob) break;
          attempts++;
        }
      }

      if (compressedBlob) {
        setCompressedUrl(URL.createObjectURL(compressedBlob));
        setStats({
          originalSize: selectedImage.size,
          compressedSize: compressedBlob.size,
          originalWidth: img.width,
          originalHeight: img.height,
          compressedWidth: canvas.width,
          compressedHeight: canvas.height,
          quality: Math.round(quality * 100)
        });
      }
    } catch (err) {
      setError('Failed to process image. Please try another file.');
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const reset = () => {
    setSelectedImage(null);
    setPreviewUrl(null);
    setCompressedUrl(null);
    setStats(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f5] text-[#1a1a1a] font-sans selection:bg-black selection:text-white">
      <header className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-5xl font-light tracking-tight mb-2">TinyPic</h1>
          <p className="text-muted-foreground text-lg max-w-md">
            Privacy-first image compression. Your files never leave your device.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm bg-white px-4 py-2 rounded-full shadow-sm border border-black/5">
          <Info className="w-4 h-4 text-blue-500" />
          <span>Processing happens entirely in your browser</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Controls & Input */}
          <div className="lg:col-span-4 space-y-6">
            <section className="bg-white p-8 rounded-[32px] shadow-sm border border-black/5">
              <div className="flex items-center gap-3 mb-6">
                <Settings2 className="w-5 h-5" />
                <h2 className="text-xl font-medium">Compression Settings</h2>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label htmlFor="targetSize" className="block text-sm font-medium text-muted-foreground mb-2">
                    Target Size (KB)
                  </label>
                  <div className="relative">
                    <input
                      id="targetSize"
                      type="number"
                      value={targetSizeKB}
                      onChange={(e) => setTargetSizeKB(Math.max(1, parseInt(e.target.value) || 0))}
                      className="w-full bg-[#f9f9f9] border border-black/10 rounded-2xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-black/5 transition-all"
                      placeholder="e.g. 100"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">KB</span>
                  </div>
                </div>

                <button
                  onClick={compressImage}
                  disabled={!selectedImage || isProcessing}
                  className="w-full bg-black text-white rounded-2xl py-4 font-medium flex items-center justify-center gap-2 hover:bg-black/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Optimizing...
                    </>
                  ) : (
                    <>
                      Optimize Image
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </div>
            </section>

            {stats && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white p-8 rounded-[32px] shadow-sm border border-black/5 space-y-4"
              >
                <h3 className="text-lg font-medium mb-4">Results</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-[#f9f9f9] rounded-2xl">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Original</p>
                    <p className="text-lg font-medium">{formatSize(stats.originalSize)}</p>
                  </div>
                  <div className="p-4 bg-emerald-50 rounded-2xl">
                    <p className="text-xs text-emerald-600 uppercase tracking-wider mb-1">Compressed</p>
                    <p className="text-lg font-medium text-emerald-700">{formatSize(stats.compressedSize)}</p>
                  </div>
                </div>
                <div className="pt-4 border-t border-black/5 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Reduction</span>
                    <span className="font-medium text-emerald-600">
                      {Math.round((1 - stats.compressedSize / stats.originalSize) * 100)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Resolution</span>
                    <span className="font-medium">{stats.compressedWidth} × {stats.compressedHeight}</span>
                  </div>
                </div>
                
                <a
                  href={compressedUrl!}
                  download={`compressed_${selectedImage?.name}`}
                  className="w-full mt-4 bg-emerald-600 text-white rounded-2xl py-4 font-medium flex items-center justify-center gap-2 hover:bg-emerald-700 transition-all active:scale-[0.98]"
                >
                  <Download className="w-5 h-5" />
                  Download Compressed
                </a>
              </motion.section>
            )}
          </div>

          {/* Right Column: Preview Area */}
          <div className="lg:col-span-8">
            <div 
              className={`relative min-h-[500px] bg-white rounded-[40px] border-2 border-dashed transition-all flex flex-col items-center justify-center p-8 ${
                !selectedImage ? 'border-black/10 hover:border-black/20' : 'border-transparent'
              }`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
            >
              <AnimatePresence mode="wait">
                {!selectedImage ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center"
                  >
                    <div className="w-20 h-20 bg-[#f9f9f9] rounded-full flex items-center justify-center mx-auto mb-6">
                      <Upload className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-2xl font-medium mb-2">Drop your image here</h3>
                    <p className="text-muted-foreground mb-8">Supports JPG, PNG, WebP</p>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="bg-black text-white px-8 py-3 rounded-full font-medium hover:bg-black/90 transition-all active:scale-[0.95]"
                    >
                      Select File
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept="image/*"
                      className="hidden"
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="preview"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full h-full flex flex-col"
                  >
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <ImageIcon className="w-5 h-5" />
                        <span className="font-medium truncate max-w-[200px]">{selectedImage.name}</span>
                      </div>
                      <button
                        onClick={reset}
                        className="p-2 hover:bg-red-50 text-red-500 rounded-full transition-all"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-grow">
                      <div className="space-y-3">
                        <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Original</p>
                        <div className="aspect-square rounded-3xl overflow-hidden bg-[#f9f9f9] border border-black/5">
                          <img
                            src={previewUrl!}
                            alt="Original"
                            className="w-full h-full object-contain"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Compressed Preview</p>
                        <div className="aspect-square rounded-3xl overflow-hidden bg-[#f9f9f9] border border-black/5 relative">
                          {compressedUrl ? (
                            <img
                              src={compressedUrl}
                              alt="Compressed"
                              className="w-full h-full object-contain"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
                              {isProcessing ? (
                                <Loader2 className="w-10 h-10 animate-spin mb-4" />
                              ) : (
                                <ImageIcon className="w-10 h-10 mb-4 opacity-20" />
                              )}
                              <p>Compressed preview will appear here after optimization</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {error && (
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-red-50 text-red-600 px-6 py-3 rounded-2xl border border-red-100 text-sm font-medium">
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-black/5 text-center text-muted-foreground text-sm">
        <p>© 2026 TinyPic • Secure Client-Side Compression</p>
      </footer>
    </div>
  );
}
