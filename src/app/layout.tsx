import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { AuthContextProvider } from './context/AuthContext';

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Leadlistclean - Email List Cleaner',
  description: 'Clean and validate email addresses in your CSV files',
  authors: [{ name: 'Leadlistclean', url: 'https://leadlistclean.com' }],
  keywords: ['email list', 'email validation', 'csv cleaner', 'email list cleaner'],
  metadataBase: new URL('https://leadlistclean.com'),
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthContextProvider>
          <main className="min-h-[calc(100vh-4rem)]">
            {children}
          </main>
          <footer className="h-16 bg-gray-50 border-t">
            <div className="max-w-5xl mx-auto px-4 h-full flex items-center justify-between">
              <div className="text-sm text-gray-600">
                &copy; {new Date().getFullYear()} Leadlistclean. All rights reserved.
              </div>
              <div className="text-sm text-gray-600">
                Need help? <a href="mailto:adityaperswal@gmail.com" className="text-[#217346] hover:underline">Contact Support</a>
              </div>
            </div>
          </footer>
        </AuthContextProvider>
      </body>
    </html>
  )
}