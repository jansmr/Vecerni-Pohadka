export interface StoryResult {
  story: string; // The full, concatenated story
  scenes: string[]; // The story divided into three parts
  imageUrls: string[]; // An array of three image URLs, one for each scene
  audioBase64?: string;
}

export interface StoryFormData {
  name: string;
  character: string;
  setting: string;
  object: string;
  storyLength: string;
}

export interface ProgressUpdate {
  step: number;
  totalSteps: number;
  message: string;
}