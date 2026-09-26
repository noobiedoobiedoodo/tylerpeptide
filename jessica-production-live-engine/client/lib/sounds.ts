import { Howl } from 'howler';

const sounds: Record<string, Howl> = {
  // Pre-approval Form Sounds (DO NOT reuse in the arcade game)

  success: new Howl({
    src: ['https://assets.mixkit.co/active_storage/sfx/2018/2018-preview.mp3'], // Success fanfare
    volume: 0.5
  }),
  selection: new Howl({
    src: ['https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3'], // Digital tick
    volume: 0.25
  }),
  
  // Dedicated Your New Auto Underground Arcade Game Sounds (Highly distinct)
  game_selection: new Howl({
    src: ['https://assets.mixkit.co/active_storage/sfx/2566/2566-preview.mp3'], // Futuristic click/snap
    volume: 0.25
  }),
  game_success: new Howl({
    src: ['https://assets.mixkit.co/active_storage/sfx/2020/2020-preview.mp3'], // Retro arcade register coin sound
    volume: 0.4
  }),
  game_horn: new Howl({
    src: ['https://upload.wikimedia.org/wikipedia/commons/8/8c/Car_Horn.wav'], // Real mechanical car horn honk
    volume: 0.35
  }),
  
  // Game Street Racing High-Impact SFX
  engine_rev: new Howl({
    src: ['https://assets.mixkit.co/active_storage/sfx/2763/2763-preview.mp3'], // Sports car rev
    volume: 0.35
  }),
  screech: new Howl({
    src: ['https://assets.mixkit.co/active_storage/sfx/2759/2759-preview.mp3'], // Tyre screech
    volume: 0.3
  }),
  nitro: new Howl({
    src: ['https://assets.mixkit.co/active_storage/sfx/2762/2762-preview.mp3'], // Turbo warp spool
    volume: 0.45
  }),
  crash: new Howl({
    src: ['https://assets.mixkit.co/active_storage/sfx/2744/2744-preview.mp3'], // Metallic impact smash
    volume: 0.5
  }),

  // Passerby Yelling Sounds (Synthesized vocal recording loops with high availability)
  yell_what: new Howl({
    src: ['https://translate.google.com/translate_tts?ie=UTF-8&q=What%20are%20you%20doing&tl=en&client=tw-ob'],
    volume: 0.85
  }),
  yell_watchout: new Howl({
    src: ['https://translate.google.com/translate_tts?ie=UTF-8&q=Hey%20watch%20out&tl=en&client=tw-ob'],
    volume: 0.85
  })
};

export const playSound = (name: keyof typeof sounds) => {
  return sounds[name]?.play();
};

export const stopSound = (name: keyof typeof sounds) => {
  sounds[name]?.stop();
};

export const setSoundVolume = (name: keyof typeof sounds, id: number, volume: number) => {
  sounds[name]?.volume(volume, id);
};

export const setSoundPan = (name: keyof typeof sounds, id: number, pan: number) => {
  sounds[name]?.stereo(pan, id);
};
