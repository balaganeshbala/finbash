import { initializeApp }   from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth }          from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore }     from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const firebaseConfig = {
  apiKey:            'AIzaSyDjhl-leKVZo4tNSPtR5GUqwcSpoBZhkro',
  authDomain:        'bond-portfolio-c50e2.firebaseapp.com',
  projectId:         'bond-portfolio-c50e2',
  storageBucket:     'bond-portfolio-c50e2.firebasestorage.app',
  messagingSenderId: '1055478108669',
  appId:             '1:1055478108669:web:d41e388bc60f6b92488994',
};

export const isConfigured = !firebaseConfig.apiKey.startsWith('REPLACE_');

export let app, auth, db;

if (isConfigured) {
  app  = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db   = getFirestore(app);
}
