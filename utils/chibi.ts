import type { CharacterProfile } from '../types';

export interface ChibiDisplay {
    img: string;
    scale: number;
    offsetY: number;
    flip: boolean;
    isFallback: boolean;
}

/** Resolve the small character illustration used by desktop widgets. */
export const getChibi = (char: CharacterProfile): ChibiDisplay => {
    const sprites = (char.activeSkinSetId && char.dateSkinSets?.find(set => set.id === char.activeSkinSetId)?.sprites)
        || char.sprites || {};
    const img = sprites.chibi || sprites.happy || sprites.normal || sprites.smile || char.avatar || '';
    return { img, scale: 1, offsetY: 0, flip: false, isFallback: true };
};
