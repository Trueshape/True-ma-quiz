import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { AudioProvider } from '@/components/audio-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { ConstellationBackground } from '@/components/constellation-background';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'TrueMaQuiz — Real-time Multiplayer Quiz',
  description: 'Create quizzes, host live games, and compete in real time with friends.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark theme-default">
      <body className={inter.className}>
        <ThemeProvider>
          <AudioProvider>
            <ConstellationBackground />
            {children}
            <Toaster />
          </AudioProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
