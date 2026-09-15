import React from 'react';
import {createRoot} from 'react-dom/client';
import {OSProvider} from '../../context/OSContext';
import {MusicProvider} from '../../context/MusicContext';
import RoomApp from '../../apps/RoomApp';
createRoot(document.getElementById('root')!).render(<OSProvider><MusicProvider><RoomApp/></MusicProvider></OSProvider>);
