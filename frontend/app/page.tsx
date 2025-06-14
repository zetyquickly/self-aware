'use client';

import { useState, useRef, useEffect } from 'react';
import { VoiceAssistant } from '../components/VoiceAssistant';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-900 text-white">
      <VoiceAssistant />
    </main>
  );
}
