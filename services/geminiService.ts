import { GoogleGenAI, Modality, Type } from "@google/genai";
import { StoryFormData, StoryResult, ProgressUpdate } from "../types";

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            // remove the header from the base64 string
            resolve(result.split(',')[1]);
        };
        reader.onerror = (error) => reject(error);
    });
};

export const generateStoryWithImage = async (
  formData: StoryFormData,
  childPhoto: File,
  onProgress: (update: ProgressUpdate) => void
): Promise<StoryResult> => {
  try {
    const lengthOptions: { [key: string]: { scenes: number; words: number } } = {
        '5': { scenes: 6, words: 400 },
        '10': { scenes: 8, words: 800 },
        '15': { scenes: 10, words: 1200 },
        '20': { scenes: 12, words: 1600 },
    };
    const selectedLength = lengthOptions[formData.storyLength] || lengthOptions['5'];
    const numScenes = selectedLength.scenes;
    const totalWords = selectedLength.words;
    
    let currentStep = 0;
    const totalSteps = numScenes + 2; // 1 for text, N for images, 1 for audio

    const updateProgress = (message: string) => {
        currentStep++;
        onProgress({ step: currentStep, totalSteps, message });
    };

    // Step 1: Generate the story text
    const storyPrompt = `Vytvoř kouzelnou a uklidňující pohádku na dobrou noc pro dítě jménem ${formData.name}. Hlavní postava, hrdina příběhu, je ${formData.character} v místě jako ${formData.setting}. V příběhu by se měl objevit ${formData.object}. Příběh musí být rozdělen přesně do ${numScenes} krátkých scén. Celková délka by měla být přibližně ${totalWords} slov. Odpovídej pouze česky a ve formátu JSON podle poskytnutého schématu.`;
    
    onProgress({ step: currentStep, totalSteps, message: 'Vymýšlím zápletku příběhu...' });
    const textModel = 'gemini-2.5-flash';
    const storyResponse = await ai.models.generateContent({
      model: textModel,
      contents: storyPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            scenes: {
              type: Type.ARRAY,
              description: `Příběh rozdělený do ${numScenes} scén.`,
              items: { type: Type.STRING }
            }
          },
          required: ["scenes"]
        }
      }
    });

    const storyData = JSON.parse(storyResponse.text);
    const scenes: string[] = storyData.scenes;
    updateProgress('Příběh je napsaný, začínám ilustrovat...');

    if (!scenes || scenes.length !== numScenes) {
        throw new Error(`Generování příběhu selhalo, nebylo vytvořeno ${numScenes} scén.`);
    }
    
    const story = scenes.join('\n\n');

    // Step 2: Generate an image for each scene
    const imageModel = 'gemini-2.5-flash-image';
    const photoBase64 = await fileToBase64(childPhoto);
    const imageUrls: string[] = [];

    for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        onProgress({ step: currentStep, totalSteps, message: `Maluji obrázek ${i + 1} z ${numScenes}...` });

        const imagePromptWithPhoto = `Vytvoř krásnou, snovou ilustraci pro tuto scénu z dětské pohádky: "${scene}". Hlavní hrdina by měl být konzistentní napříč obrázky a inspirovaný dítětem na nahrané fotografii, ale v malebném, pohádkovém stylu. Celková nálada by měla být kouzelná, jemná a uklidňující. Do obrázku nevkládej žádný text.`;
        
        let imageResponse = await ai.models.generateContent({
            model: imageModel,
            contents: {
                parts: [
                    { inlineData: { data: photoBase64, mimeType: childPhoto.type } },
                    { text: imagePromptWithPhoto }
                ]
            },
            config: {
                responseModalities: [Modality.IMAGE],
            },
        });
        
        let candidate = imageResponse.candidates?.[0];

        if (!candidate?.content?.parts) {
            console.warn('Image generation with photo was blocked. Retrying without photo for scene:', scene);
            const imagePromptWithoutPhoto = `Vytvoř krásnou, snovou ilustraci pro tuto scénu z dětské pohádky: "${scene}". Hlavní postava je ${formData.character}. Celková nálada by měla být kouzelná, jemná a uklidňující. Do obrázku nevkládej žádný text.`;

            imageResponse = await ai.models.generateContent({
                model: imageModel,
                contents: { parts: [{ text: imagePromptWithoutPhoto }] },
                config: {
                    responseModalities: [Modality.IMAGE],
                },
            });
            candidate = imageResponse.candidates?.[0];
        }

        if (!candidate?.content?.parts) {
            console.error('Image generation failed on second attempt (without photo) for scene:', scene);
            throw new Error('Bohužel se nepodařilo vytvořit obrázek pro jednu ze scén. Zkuste prosím mírně pozměnit popis postavy nebo prostředí a vytvořit příběh znovu.');
        }

        let imageFound = false;
        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                const base64ImageBytes: string = part.inlineData.data;
                imageUrls.push(`data:image/png;base64,${base64ImageBytes}`);
                imageFound = true;
                break; 
            }
        }
        if (!imageFound) {
            throw new Error('V odpovědi pro jednu ze scén nebyla nalezena žádná obrazová data.');
        }
        updateProgress(`Ilustrace ${i + 1}/${numScenes} je hotová.`);
    }

    if (imageUrls.length !== numScenes) {
      throw new Error(`Generování obrázků selhalo, nebylo vytvořeno ${numScenes} obrázků.`);
    }

    // Step 3: Generate audio for the full story
    onProgress({ step: currentStep, totalSteps, message: 'Nahrávám hlas vypravěče...' });
    const audioModel = 'gemini-2.5-flash-preview-tts';
    const audioPrompt = `Přečti tuto pohádku klidným a uklidňujícím hlasem pro dítě: "${story}"`;
    
    const audioResponse = await ai.models.generateContent({
        model: audioModel,
        contents: [{ parts: [{ text: audioPrompt }] }],
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: 'Kore' },
                },
            },
        },
    });
    
    const audioBase64 = audioResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    updateProgress('Vše je připraveno!');
    
    return {
      story,
      scenes,
      imageUrls,
      audioBase64,
    };

  } catch (error) {
    console.error("Error generating story:", error);
    // Re-throw the error to be caught by the UI component
    throw error;
  }
};