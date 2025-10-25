import React, { useState, useCallback, useRef, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { generateStoryWithImage } from './services/geminiService';
import { StoryResult, StoryFormData, ProgressUpdate } from './types';
import { MagicWandIcon, UploadIcon, SpinnerIcon, SparklesIcon, BookOpenIcon, UserIcon, ImageIcon, PlanetIcon, KeyIcon, PlayIcon, PauseIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, ClockIcon } from './components/icons';

// Audio decoding functions as per documentation
function decode(base64: string) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

async function decodeAudioData(
    data: Uint8Array,
    ctx: AudioContext,
    sampleRate: number,
    numChannels: number,
): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
        }
    }
    return buffer;
}


const App: React.FC = () => {
  const [form, setForm] = useState<StoryFormData>({
    name: '',
    character: 'statečný medvídek',
    setting: 'třpytivý, kouzelný les',
    object: 'zářící lucerna',
    storyLength: '5',
  });
  const [childPhoto, setChildPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [result, setResult] = useState<StoryResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);

  const audioRef = useRef<{ context: AudioContext | null; source: AudioBufferSourceNode | null }>({ context: null, source: null });
  const timerRef = useRef<number | null>(null);


  useEffect(() => {
    // Cleanup function to stop audio and close context when a new story is generated or component unmounts
    return () => {
      audioRef.current.source?.stop();
      if (audioRef.current.context && audioRef.current.context.state !== 'closed') {
        audioRef.current.context.close();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [result]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setChildPhoto(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };
  
  const handlePlayPause = async () => {
    if (isPlaying && audioRef.current.source) {
      audioRef.current.source.stop();
      setIsPlaying(false);
      return;
    }
  
    if (!result?.audioBase64) return;
  
    try {
      if (!audioRef.current.context || audioRef.current.context.state === 'closed') {
        audioRef.current.context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      
      const audioBuffer = await decodeAudioData(decode(result.audioBase64), audioRef.current.context, 24000, 1);
      const source = audioRef.current.context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioRef.current.context.destination);
      
      source.onended = () => {
        setIsPlaying(false);
        audioRef.current.source = null;
      };
  
      source.start();
      audioRef.current.source = source;
      setIsPlaying(true);
    } catch (e) {
      console.error("Failed to play audio", e);
      setError("Nepodařilo se přehrát zvuk.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!childPhoto) {
      setError('Prosím, nahrajte fotku svého dítěte.');
      return;
    }
    setError(null);
    setIsLoading(true);
    setResult(null);
    setCurrentSceneIndex(0);

    const lengthOptions: { [key: string]: { scenes: number } } = {
        '5': { scenes: 6 }, '10': { scenes: 8 }, '15': { scenes: 10 }, '20': { scenes: 12 },
    };
    const numScenes = lengthOptions[form.storyLength]?.scenes || 6;
    const totalSteps = numScenes + 2; // 1 for text, N for images, 1 for audio
    const estimatedTime = 5 + (numScenes * 8) + 5; // Rough estimate: 5s text, 8s/image, 5s audio
    
    setTimeRemaining(estimatedTime);
    setProgress({ step: 0, totalSteps, message: 'Příprava kouzel...' });

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
        setTimeRemaining(prev => Math.max(0, prev - 1));
    }, 1000);

    try {
      const storyResult = await generateStoryWithImage(form, childPhoto, setProgress);
      setResult(storyResult);
    } catch (err) {
      console.error(err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Vyskytla se neznámá chyba. Zkuste to prosím znovu.');
      }
    } finally {
      setIsLoading(false);
      if (timerRef.current) clearInterval(timerRef.current);
      setProgress(null);
    }
  };

  const handleReset = () => {
    audioRef.current.source?.stop();
    setIsPlaying(false);
    setResult(null);
    setError(null);
    setChildPhoto(null);
    setPhotoPreview(null);
    setCurrentSceneIndex(0);
    setProgress(null);
    if (timerRef.current) clearInterval(timerRef.current);
    setForm({
        name: '',
        character: 'statečný medvídek',
        setting: 'třpytivý, kouzelný les',
        object: 'zářící lucerna',
        storyLength: '5',
    });
  };

  const handleDownloadPdf = async () => {
    if (!result) return;
    setIsDownloadingPdf(true);
    setError(null);

    try {
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4'
        });

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 15;

        // --- Title Page ---
        doc.setFontSize(32);
        doc.text(`Dobrodružství ${form.name}`, pageWidth / 2, pageHeight / 2 - 10, { align: 'center' });
        doc.setFontSize(16);
        doc.setTextColor(100);
        doc.text('Vytvořeno s Večerní Pohádkou', pageWidth / 2, pageHeight / 2 + 10, { align: 'center' });

        const contentWidth = pageWidth - margin * 2;
        const contentHeight = pageHeight - margin * 2;
        const columnWidth = contentWidth / 2 - 5; // 10mm gutter for spacing
        const textColumnX = margin + columnWidth + 10;

        for (let i = 0; i < result.scenes.length; i++) {
            doc.addPage();
            
            const imageUrl = result.imageUrls[i];
            
            // --- Image on the left ---
            try {
                const imgProps = doc.getImageProperties(imageUrl);
                const aspectRatio = imgProps.width / imgProps.height;
                
                let imgWidth = columnWidth;
                let imgHeight = imgWidth / aspectRatio;

                if (imgHeight > contentHeight) {
                    imgHeight = contentHeight;
                    imgWidth = imgHeight * aspectRatio;
                }
                
                // Center the image vertically in its available space
                const imageY = margin + (contentHeight - imgHeight) / 2;
                doc.addImage(imageUrl, 'PNG', margin, imageY, imgWidth, imgHeight);

            } catch (e) {
                console.error(`Could not process image ${i}`, e);
                doc.rect(margin, margin, columnWidth, contentHeight);
                doc.text("Obrázek se nepodařilo načíst.", margin + 5, margin + 10);
            }
            
            // --- Text on the right ---
            doc.setFontSize(12);
            doc.setTextColor(0);
            const textLines = doc.splitTextToSize(result.scenes[i], columnWidth);
            
            // Center the text block vertically
            const textBlockHeight = doc.getTextDimensions(textLines).h;
            const textY = margin + (contentHeight - textBlockHeight) / 2;

            doc.text(textLines, textColumnX, textY > margin ? textY : margin);
        }

        doc.save(`Dobrodružství_${form.name.replace(/\s/g, '_')}.pdf`);
    } catch (e) {
        console.error("Failed to generate PDF", e);
        setError("Nepodařilo se vytvořit PDF. Zkuste to prosím znovu.");
    } finally {
        setIsDownloadingPdf(false);
    }
  };

  const renderForm = () => (
    <div className="w-full max-w-2xl mx-auto">
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <InputField icon={<UserIcon />} label="Jméno dítěte" name="name" value={form.name} onChange={handleInputChange} placeholder="např. Liliana" />
                <InputField icon={<BookOpenIcon />} label="Hlavní postava" name="character" value={form.character} onChange={handleInputChange} placeholder="např. statečný rytíř" />
                <InputField icon={<PlanetIcon />} label="Prostředí příběhu" name="setting" value={form.setting} onChange={handleInputChange} placeholder="např. kouzelný les" />
                <InputField icon={<KeyIcon />} label="Oblíbená hračka nebo speciální předmět" name="object" value={form.object} onChange={handleInputChange} placeholder="např. oblíbený plyšák" />
            </div>
            
            <SelectField icon={<ClockIcon />} label="Délka příběhu" name="storyLength" value={form.storyLength} onChange={handleInputChange}>
                <option value="5">Krátký (cca 5 minut)</option>
                <option value="10">Střední (cca 10 minut)</option>
                <option value="15">Dlouhý (cca 15 minut)</option>
                <option value="20">Velmi dlouhý (cca 20 minut)</option>
            </SelectField>

            <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-lg text-center">
              <label htmlFor="photo-upload" className="cursor-pointer block">
                <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-600 hover:border-indigo-500 rounded-lg transition-colors">
                  {photoPreview ? (
                    <img src={photoPreview} alt="Náhled fotky dítěte" className="w-32 h-32 rounded-full object-cover mb-4 ring-4 ring-indigo-500" />
                  ) : (
                    <div className="flex flex-col items-center">
                      <UploadIcon className="w-12 h-12 text-slate-500 mb-2" />
                      <p className="text-slate-400 font-semibold">Nahrát fotku dítěte</p>
                      <p className="text-xs text-slate-500">Pro inspiraci hrdiny příběhu</p>
                    </div>
                  )}
                </div>
              </label>
              <input id="photo-upload" name="photo-upload" type="file" className="sr-only" accept="image/*" onChange={handleFileChange} />
            </div>

            <button
                type="submit"
                disabled={isLoading || !childPhoto || !form.name}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-all duration-300 transform hover:scale-105 shadow-lg shadow-indigo-600/30"
            >
                <MagicWandIcon className="w-5 h-5" />
                <span>Uplést sen</span>
            </button>
        </form>
    </div>
  );

  const renderLoading = () => {
    const progressPercentage = progress && progress.totalSteps > 0
        ? Math.round((progress.step / progress.totalSteps) * 100)
        : 0;

    const formatTime = (seconds: number): string => {
        if (isLoading && seconds <= 0) return "Dokončuji...";
        if (seconds <= 0) return "chvilička";

        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        
        const getPlural = (num: number, one: string, few: string, many: string) => {
            if (num === 1) return one;
            if (num > 1 && num < 5) return few;
            return many;
        }

        const parts = [];
        if (minutes > 0) {
            parts.push(`${minutes} ${getPlural(minutes, 'minuta', 'minuty', 'minut')}`);
        }
        if (remainingSeconds > 0) {
            parts.push(`${remainingSeconds} ${getPlural(remainingSeconds, 'sekunda', 'sekundy', 'sekund')}`);
        }
        return `Zbývá přibližně ${parts.join(' a ')}`;
    };

    return (
        <div className="text-center flex flex-col items-center justify-center space-y-6 py-10 w-full max-w-xl mx-auto">
            <SpinnerIcon className="w-16 h-16 text-indigo-400" />
            <p className="text-xl text-slate-300 font-semibold">{progress ? progress.message : 'Naši vypravěči pilně pracují...'}</p>
            
            <div className="w-full bg-slate-700 rounded-full h-4 overflow-hidden shadow-inner">
                <div 
                    className="bg-gradient-to-r from-indigo-500 to-purple-500 h-4 rounded-full transition-all duration-500 ease-out" 
                    style={{ width: `${progressPercentage}%` }}
                ></div>
            </div>
            
            <div className="flex justify-between w-full text-sm text-slate-400">
                <span>Postup: {progressPercentage}%</span>
                <span>{formatTime(timeRemaining)}</span>
            </div>
        </div>
    );
};

  const renderResult = () => result && (
    <div className="w-full max-w-4xl mx-auto bg-slate-800/50 rounded-2xl shadow-2xl shadow-indigo-900/20 overflow-hidden animate-fade-in">
        <div className="p-4 sm:p-8">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
                <h2 className="text-3xl sm:text-4xl font-bold text-center sm:text-left text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">Dobrodružství {form.name}</h2>
                {result.audioBase64 && (
                    <button
                        onClick={handlePlayPause}
                        className="flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 px-5 rounded-full transition-all duration-300 transform hover:scale-105 shadow-lg"
                        aria-label={isPlaying ? "Pozastavit příběh" : "Přehrát příběh"}
                    >
                        {isPlaying ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6" />}
                        <span>{isPlaying ? "Pozastavit" : "Poslouchat"}</span>
                    </button>
                )}
            </div>
            
            <div className="relative">
                <div className="aspect-w-16 aspect-h-9 mb-6 rounded-xl overflow-hidden shadow-lg">
                    <img src={result.imageUrls[currentSceneIndex]} alt={`Ilustrace pro scénu ${currentSceneIndex + 1}`} className="w-full h-full object-cover transition-opacity duration-300" />
                </div>
                
                {result.imageUrls.length > 1 && (
                    <>
                        <button 
                            onClick={() => setCurrentSceneIndex(prev => Math.max(0, prev - 1))}
                            disabled={currentSceneIndex === 0}
                            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 transform bg-violet-600/70 hover:bg-violet-700/90 text-white p-2 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            aria-label="Předchozí scéna"
                        >
                            <ChevronLeftIcon className="w-6 h-6" />
                        </button>
                        <button 
                            onClick={() => setCurrentSceneIndex(prev => Math.min(result.imageUrls.length - 1, prev + 1))}
                            disabled={currentSceneIndex === result.imageUrls.length - 1}
                            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 transform bg-violet-600/70 hover:bg-violet-700/90 text-white p-2 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            aria-label="Další scéna"
                        >
                            <ChevronRightIcon className="w-6 h-6" />
                        </button>
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                            {result.imageUrls.map((_, index) => (
                                <button key={index} onClick={() => setCurrentSceneIndex(index)} className={`w-3 h-3 rounded-full ${currentSceneIndex === index ? 'bg-violet-400' : 'bg-slate-500/50'}`}></button>
                            ))}
                        </div>
                    </>
                )}
            </div>

            <div className="prose prose-invert prose-lg max-w-none text-slate-300 leading-relaxed text-justify">
                <p>{result.scenes[currentSceneIndex]}</p>
            </div>
            <div className="mt-8 flex flex-col gap-4">
                <button
                    onClick={handleDownloadPdf}
                    disabled={isDownloadingPdf}
                    className="w-full flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-all duration-300 transform hover:scale-105 shadow-lg shadow-teal-600/30"
                >
                    {isDownloadingPdf ? <SpinnerIcon className="w-5 h-5" /> : <DownloadIcon className="w-5 h-5" />}
                    <span>{isDownloadingPdf ? 'Generuji PDF...' : 'Stáhnout jako PDF'}</span>
                </button>
                <button
                    onClick={handleReset}
                    className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 px-4 rounded-lg transition-all duration-300 transform hover:scale-105 shadow-lg shadow-purple-600/30"
                >
                    <SparklesIcon className="w-5 h-5" />
                    <span>Vytvořit další kouzelný příběh</span>
                </button>
            </div>
        </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 flex flex-col items-center justify-center">
      <div className="w-full text-center mb-8">
        <h1 className="text-4xl sm:text-5xl font-extrabold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500">
          Večerní Pohádka
        </h1>
        <p className="text-slate-400">Personalizované pohádky na dobrou noc, malované kouzly</p>
      </div>

      <div className="w-full">
        {isLoading ? renderLoading() : (result ? renderResult() : renderForm())}
      </div>

      {error && (
        <div className="mt-6 bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg relative" role="alert">
          <strong className="font-bold">Ach ne! </strong>
          <span className="block sm:inline">{error}</span>
        </div>
      )}
    </div>
  );
};

interface InputFieldProps {
    icon: React.ReactNode;
    label: string;
    name: string;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder: string;
}

const InputField: React.FC<InputFieldProps> = ({ icon, label, name, value, onChange, placeholder }) => (
    <div className="relative">
        <label htmlFor={name} className="block text-sm font-medium text-slate-400 mb-1 ml-1">{label}</label>
        <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <span className="text-slate-500">{icon}</span>
            </div>
            <input
                type="text"
                name={name}
                id={name}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                required
                className="block w-full rounded-md border-0 py-3 pl-10 bg-slate-800/50 text-white shadow-sm ring-1 ring-inset ring-slate-700 placeholder:text-slate-500 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm sm:leading-6 transition-colors"
            />
        </div>
    </div>
);

interface SelectFieldProps {
    icon: React.ReactNode;
    label: string;
    name: string;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
    children: React.ReactNode;
}

const SelectField: React.FC<SelectFieldProps> = ({ icon, label, name, value, onChange, children }) => (
    <div className="relative">
        <label htmlFor={name} className="block text-sm font-medium text-slate-400 mb-1 ml-1">{label}</label>
        <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <span className="text-slate-500">{icon}</span>
            </div>
            <select
                name={name}
                id={name}
                value={value}
                onChange={onChange}
                className="block w-full appearance-none rounded-md border-0 py-3 pl-10 bg-slate-800/50 text-white shadow-sm ring-1 ring-inset ring-slate-700 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm sm:leading-6 transition-colors"
            >
                {children}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                </svg>
            </div>
        </div>
    </div>
);

export default App;