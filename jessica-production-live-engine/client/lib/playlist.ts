import { Howl } from 'howler';

export interface Track {
  id: string;
  title: string;
  artist: string;
  genre: 'Synthwave' | 'EDM' | 'Rock' | 'Cyberpunk';
  url: string;
}

export const PLAYLIST: Track[] = [
  {
    id: 'track_01',
    title: 'Purple Night',
    artist: 'Ionov',
    genre: 'Synthwave',
    url: 'https://archive.org/download/synthwave-dreams-vol.-1-16/Synthwave%20Dreams%20Vol.%201-16/VA%20-%20Synthwave%20Dreams%20Vol.%201%20%282019%29/01.%20Ionov%20-%20Purple%20Night.mp3'
  },
  {
    id: 'track_02',
    title: 'Victory',
    artist: 'Aurolab',
    genre: 'EDM',
    url: 'https://archive.org/download/synthwave-dreams-vol.-1-16/Synthwave%20Dreams%20Vol.%201-16/VA%20-%20Synthwave%20Dreams%20Vol.%201%20%282019%29/02.%20Aurolab%20-%20Victory.mp3'
  },
  {
    id: 'track_03',
    title: 'Submitting Space',
    artist: 'M-Fast',
    genre: 'Cyberpunk',
    url: 'https://archive.org/download/synthwave-dreams-vol.-1-16/Synthwave%20Dreams%20Vol.%201-16/VA%20-%20Synthwave%20Dreams%20Vol.%201%20%282019%29/03.%20M-Fast%20-%20Submitting%20Space.mp3'
  },
  {
    id: 'track_04',
    title: 'Our Electric Summer',
    artist: 'NINJACAT',
    genre: 'Rock',
    url: 'https://archive.org/download/synthwave-dreams-vol.-1-16/Synthwave%20Dreams%20Vol.%201-16/VA%20-%20Synthwave%20Dreams%20Vol.%201%20%282019%29/04.%20NINJACAT%20-%20Our%20Electric%20Summer.mp3'
  }
];

let globalHowl: Howl | null = null;
let currentTrackUrl = '';

export const playSoundtrack = (url: string, volume: number = 0.35) => {
  try {
    if (globalHowl) {
      if (currentTrackUrl === url) {
        if (!globalHowl.playing()) {
          globalHowl.play();
        }
        return;
      }
      globalHowl.stop();
      globalHowl.unload();
    }
    
    globalHowl = new Howl({
      src: [url],
      html5: true, // Crucial for streaming large audio track sizes
      loop: true,
      volume: volume
    });
    
    currentTrackUrl = url;
    globalHowl.play();
  } catch (e) {
    console.error("Audio playback error:", e);
  }
};

export const pauseSoundtrack = () => {
  if (globalHowl) {
    globalHowl.pause();
  }
};

export const setSoundtrackVolume = (volume: number) => {
  if (globalHowl) {
    globalHowl.volume(volume);
  }
};
