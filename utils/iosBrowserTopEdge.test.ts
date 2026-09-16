// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installIOSBrowserTopEdge } from './iosBrowserTopEdge';
import { Capacitor } from '@capacitor/core';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => false) } }));

describe('iOS browser top edge', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="root"><button>返回</button></div>';
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/27.0 Safari/604.1');
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    });
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false); });

    it('mounts once outside React and leaves controls and document flow alone', () => {
        installIOSBrowserTopEdge();
        installIOSBrowserTopEdge();
        const edge = document.getElementById('sully-ios-browser-top-edge')!;
        expect(document.querySelectorAll('#sully-ios-browser-top-edge')).toHaveLength(1);
        expect(edge.parentElement).toBe(document.body);
        expect(edge.style.position).toBe('fixed');
        expect(edge.style.pointerEvents).toBe('none');
        expect(edge.getAttribute('aria-hidden')).toBe('true');
        expect(document.querySelector('#root button')?.textContent).toBe('返回');
        expect(document.body.style.paddingTop).toBe('');
    });
    it('does not change standalone apps', () => {
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
        installIOSBrowserTopEdge();
        expect(document.getElementById('sully-ios-browser-top-edge')).toBeNull();
    });
    it('does not change native apps', () => {
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
        installIOSBrowserTopEdge();
        expect(document.getElementById('sully-ios-browser-top-edge')).toBeNull();
    });
    it.each(['Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140', 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140'])(
        'does not change other platforms: %s', (ua) => {
            vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
            installIOSBrowserTopEdge();
            expect(document.getElementById('sully-ios-browser-top-edge')).toBeNull();
        },
    );
});
