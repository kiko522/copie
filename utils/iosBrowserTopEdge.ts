import { Capacitor } from '@capacitor/core';
import { isIOSDevice, isStandaloneDisplayMode } from './iosStandalone';

const EDGE_ID = 'sully-ios-browser-top-edge';

/**
 * Give Safari's scroll-edge color detection a real, opaque, viewport-fixed node.
 * Keep it outside the shell's paint containment, filters and entry animation.
 * This is a compatibility candidate, not a CSS switch for the native blur effect.
 * See docs/ios-browser-top-edge.md for the required on-device acceptance check.
 */
export const createBrowserTopEdge = (): HTMLDivElement => {
    const edge = document.createElement('div');
    edge.id = EDGE_ID;
    edge.setAttribute('aria-hidden', 'true');
    edge.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:4px',
        'background-color:#0f1115', 'pointer-events:none', 'z-index:2147483647',
    ].join(';');
    return edge;
};

export const installIOSBrowserTopEdge = (): void => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    if (!isIOSDevice() || isStandaloneDisplayMode() || Capacitor.isNativePlatform()) return;
    if (!document.body || document.getElementById(EDGE_ID)) return;
    document.body.appendChild(createBrowserTopEdge());
};
