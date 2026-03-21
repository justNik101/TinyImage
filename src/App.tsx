/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback } from 'react';
import { Upload, Download, Image as ImageIcon, X, Loader2, ArrowRight, Settings2, Info, Scan } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

declare global {
  interface Window {
    cv: any;
  }
}

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
  const [isScanMode, setIsScanMode] = useState(false);
  const [scanSettings, setScanSettings] = useState({
    noise: 15,
    tilt: 0.5,
    blur: 0.3,
    bw: true
  });
  const [isOpenCVReady, setIsOpenCVReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Check if OpenCV is ready
  React.useEffect(() => {
    const checkOpenCV = setInterval(() => {
      if (window.cv && window.cv.imread) {
        setIsOpenCVReady(true);
        clearInterval(checkOpenCV);
      }
    }, 100);
    return () => clearInterval(checkOpenCV);
  }, []);
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

      // --- PHASE 1: SCANNING (Only if Scan Mode is enabled) ---
      let sourceElement: HTMLImageElement | HTMLCanvasElement = img;
      
      if (isScanMode) {
        const scanCanvas = document.createElement('canvas');
        scanCanvas.width = img.width;
        scanCanvas.height = img.height;
        const scanCtx = scanCanvas.getContext('2d')!;
        
        // 1. Background Fill (White)
        scanCtx.fillStyle = 'white';
        scanCtx.fillRect(0, 0, scanCanvas.width, scanCanvas.height);

        // 2. Slight Tilt (Inspired by lookscanned.io)
        const tilt = (Math.random() - 0.5) * (scanSettings.tilt * 2);
        scanCtx.save();
        scanCtx.translate(scanCanvas.width / 2, scanCanvas.height / 2);
        scanCtx.rotate((tilt * Math.PI) / 180);
        
        // 3. Draw Image with Filters
        scanCtx.filter = `grayscale(${scanSettings.bw ? 1 : 0}) contrast(1.2) brightness(1.05) blur(${scanSettings.blur}px)`;
        scanCtx.drawImage(img, -scanCanvas.width / 2, -scanCanvas.height / 2, scanCanvas.width, scanCanvas.height);
        scanCtx.restore();

        // 4. Add Noise/Grain (Inspired by lookscanned.io)
        const imageData = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const noise = (Math.random() - 0.5) * scanSettings.noise;
          data[i] = Math.min(255, Math.max(0, data[i] + noise));
          data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
          data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
        }
        scanCtx.putImageData(imageData, 0, 0);

        // 5. Optional: Adaptive Thresholding (If B&W is enabled and OpenCV is ready)
        if (scanSettings.bw && isOpenCVReady) {
          try {
            const cv = window.cv;
            let src = cv.imread(scanCanvas);
            let dst = new cv.Mat();
            
            // Convert to grayscale
            cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY, 0);
            
            // Add a slight blur to help merge edges into solid strokes (fixes "hollow" signatures)
            cv.GaussianBlur(src, src, new cv.Size(3, 3), 0);
            
            // Increase block size (from 15 to 41) to capture solid areas rather than just borders
            // C value (10) helps remove background noise
            cv.adaptiveThreshold(
              src, 
              dst, 
              255, 
              cv.ADAPTIVE_THRESH_GAUSSIAN_C, 
              cv.THRESH_BINARY, 
              41, 
              10
            );
            
            cv.imshow(scanCanvas, dst);
            src.delete(); dst.delete();
          } catch (e) {
            console.warn('OpenCV processing failed, falling back to basic filters', e);
          }
        }
        
        sourceElement = scanCanvas;
      }

      // --- PHASE 2: ITERATIVE COMPRESSION ---
      const targetSizeBytes = targetSizeKB * 1024;
      let quality = 0.9;
      let scale = 1.0;
      let compressedBlob: Blob | null = null;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      let attempts = 0;
      const maxAttempts = 40;
      let bestBlob: Blob | null = null;
      let bestQuality = quality;
      let bestScale = scale;

      while (attempts < maxAttempts) {
        const currentWidth = Math.max(1, sourceElement.width * scale);
        const currentHeight = Math.max(1, sourceElement.height * scale);
        canvas.width = currentWidth;
        canvas.height = currentHeight;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(sourceElement, 0, 0, canvas.width, canvas.height);

        compressedBlob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
        });

        if (!compressedBlob) break;

        if (compressedBlob.size <= targetSizeBytes) {
          bestBlob = compressedBlob;
          bestQuality = quality;
          bestScale = scale;
          if (compressedBlob.size > targetSizeBytes * 0.9) break;
          break;
        }

        if (quality > 0.3) {
          quality -= 0.1;
        } else {
          scale *= 0.85;
          quality = 0.6;
        }

        if (scale < 0.05) break; 
        attempts++;
      }

      if (bestBlob || compressedBlob) {
        const finalBlob = bestBlob || compressedBlob;
        setCompressedUrl(URL.createObjectURL(finalBlob!));
        setStats({
          originalSize: selectedImage.size,
          compressedSize: finalBlob!.size,
          originalWidth: img.width,
          originalHeight: img.height,
          compressedWidth: Math.round(sourceElement.width * (bestBlob ? bestScale : scale)),
          compressedHeight: Math.round(sourceElement.height * (bestBlob ? bestScale : scale)),
          quality: Math.round((bestBlob ? bestQuality : quality) * 100)
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

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-[#f9f9f9] rounded-2xl border border-black/5">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${isScanMode ? 'bg-black text-white' : 'bg-white text-black/40'}`}>
                        <Scan className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Scan Mode</p>
                        <p className="text-xs text-muted-foreground">
                          {isOpenCVReady ? 'Look Scanned Effect' : 'Loading Scanner...'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setIsScanMode(!isScanMode)}
                      disabled={!isOpenCVReady}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        isScanMode ? 'bg-black' : 'bg-black/10'
                      } ${!isOpenCVReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          isScanMode ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  <AnimatePresence>
                    {isScanMode && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden space-y-4 p-4 bg-[#f9f9f9] rounded-2xl border border-black/5"
                      >
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Noise (Grain)</span>
                            <span className="font-medium">{scanSettings.noise}</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="50"
                            value={scanSettings.noise}
                            onChange={(e) => setScanSettings({ ...scanSettings, noise: parseInt(e.target.value) })}
                            className="w-full h-1.5 bg-black/10 rounded-lg appearance-none cursor-pointer accent-black"
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Tilt (Rotation)</span>
                            <span className="font-medium">{scanSettings.tilt}°</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="5"
                            step="0.1"
                            value={scanSettings.tilt}
                            onChange={(e) => setScanSettings({ ...scanSettings, tilt: parseFloat(e.target.value) })}
                            className="w-full h-1.5 bg-black/10 rounded-lg appearance-none cursor-pointer accent-black"
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Blur (Focus)</span>
                            <span className="font-medium">{scanSettings.blur}px</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="2"
                            step="0.1"
                            value={scanSettings.blur}
                            onChange={(e) => setScanSettings({ ...scanSettings, blur: parseFloat(e.target.value) })}
                            className="w-full h-1.5 bg-black/10 rounded-lg appearance-none cursor-pointer accent-black"
                          />
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-black/5">
                          <span className="text-xs text-muted-foreground font-medium">Black & White</span>
                          <button
                            onClick={() => setScanSettings({ ...scanSettings, bw: !scanSettings.bw })}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                              scanSettings.bw ? 'bg-black' : 'bg-black/10'
                            }`}
                          >
                            <span
                              className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                scanSettings.bw ? 'translate-x-5' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
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
