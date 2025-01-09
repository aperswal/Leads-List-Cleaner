"use client";

import React, { useState, useEffect } from 'react';
import { Upload } from 'lucide-react';
import Papa from 'papaparse';
import { useAuth } from '../context/AuthContext';
import { doc, getDoc, setDoc, increment, collection, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { verifyEmail, verifyEmails } from '../lib/emailVerifier';

interface ProcessedEmail {
  email: string;
  isValid: boolean;
  reason?: string;
}

const EmailCleaner = () => {
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any[][] | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [userIP, setUserIP] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [totalEmails, setTotalEmails] = useState<number>(0);
  const [verifiedEmails, setVerifiedEmails] = useState<number>(0);
  const [originalData, setOriginalData] = useState<any[][]>([]);
  const [emailColumnIndex, setEmailColumnIndex] = useState<number>(-1);
  const { user, signInWithGoogle, logout } = useAuth();

  // Fetch user's IP address
  useEffect(() => {
    const getIP = async () => {
      try {
        console.log('Fetching IP address...');
        const res = await fetch('/api/get-ip');
        const data = await res.json();
        console.log('IP address response:', data);
        if (data.error) {
          console.error('Error in IP response:', data.error);
          return;
        }
        setUserIP(data.ip);
        console.log('IP address set:', data.ip);
      } catch (error) {
        console.error('Error fetching IP:', error);
      }
    };
    getIP();
  }, []);

  // Fetch credits based on user auth status or IP
  useEffect(() => {
    let isMounted = true;

    const fetchCredits = async () => {
      try {
        if (!userIP) {
          console.log('Waiting for userIP...');
          return;
        }

        console.log('Starting credit fetch. User:', user?.email, 'IP:', userIP);

        if (user) {
          console.log('Fetching credits for user:', user.uid);
          const userRef = doc(db, 'users', user.uid);
          
          try {
            const userDoc = await getDoc(userRef);
            
            if (!isMounted) return;

            if (userDoc.exists()) {
              const userData = userDoc.data();
              const credits = userData.credits || 0;
              console.log('Existing user data:', userData);
              setCredits(credits);
            } else {
              console.log('New user, setting 3 credits');
              const userData = {
                credits: 3,
                email: user.email,
                createdAt: new Date().toISOString(),
                lastLogin: new Date().toISOString()
              };
              await setDoc(userRef, userData);
              console.log('Created new user document:', userData);
              
              if (!isMounted) return;
              setCredits(3);
            }
          } catch (firestoreError) {
            console.error('Firestore operation failed:', firestoreError);
            setError('Failed to access user data. Please try again.');
          }
        } else {
          console.log('Fetching credits for IP:', userIP);
          const ipRef = doc(db, 'ip_credits', userIP);
          
          try {
            const ipDoc = await getDoc(ipRef);
            
            if (!isMounted) return;

            if (ipDoc.exists()) {
              const ipData = ipDoc.data();
              const credits = ipData.credits || 0;
              console.log('Existing IP data:', ipData);
              setCredits(credits);
            } else {
              console.log('New IP, setting 1 credit');
              const ipData = {
                credits: 1,
                createdAt: new Date().toISOString(),
                lastUsed: new Date().toISOString()
              };
              await setDoc(ipRef, ipData);
              console.log('Created new IP document:', ipData);
              
              if (!isMounted) return;
              setCredits(1);
            }
          } catch (firestoreError) {
            console.error('Firestore operation failed:', firestoreError);
            setError('Failed to access credit data. Please try again.');
          }
        }
      } catch (error) {
        console.error('Error in credit fetch:', error);
        if (isMounted) {
          setError('Error loading credits. Please try refreshing the page.');
        }
      }
    };

    fetchCredits();

    return () => {
      isMounted = false;
    };
  }, [user, userIP]);

  const useCredit = async () => {
    try {
      if (!userIP) {
        console.error('No userIP available');
        return false;
      }

      const docRef = user ? 
        doc(db, 'users', user.uid) : 
        doc(db, 'ip_credits', userIP);

      // Use a transaction to ensure atomic credit updates
      const success = await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(docRef);
        
        if (!docSnap.exists()) {
          console.error('No credit document found');
          return false;
        }

        const currentCredits = docSnap.data().credits || 0;
        
        if (currentCredits <= 0) {
          console.log('No credits remaining');
          return false;
        }

        // Update credits and timestamp
        transaction.update(docRef, {
          credits: currentCredits - 1,
          lastUsed: new Date().toISOString(),
          totalUsed: (docSnap.data().totalUsed || 0) + 1
        });

        return true;
      });

      if (success) {
        setCredits(prev => prev !== null ? prev - 1 : null);
        return true;
      } else {
        setError('No credits remaining. Please sign in to get more credits.');
        return false;
      }
    } catch (error) {
      console.error('Error using credit:', error);
      setError('Error updating credits. Please try again.');
      return false;
    }
  };

  const findEmailColumns = (headers: string[]): number[] => {
    return headers.reduce((acc: number[], header: string, index: number) => {
      if (header.toLowerCase().includes('email')) {
        acc.push(index);
      }
      return acc;
    }, []);
  };

  const processFile = async (file: File) => {
    if (credits === null || credits <= 0) {
      setError('No credits remaining. Please sign in to get more credits.');
      return;
    }

    try {
      setProcessing(true);
      setProgress(0);
      setError(null);

      // First attempt to use a credit
      const creditUsed = await useCredit();
      if (!creditUsed) {
        setProcessing(false);
        return;
      }

      // Start timing the process
      const startTime = Date.now();
      const minProcessingTime = 2000; // Minimum 2 seconds for animation

      // Process the file
      Papa.parse(file, {
        header: false,
        complete: async (results) => {
          try {
            const data = results.data as string[][];
            if (data.length < 2) { // Need at least headers and one row
              setError('CSV file is empty');
              setProcessing(false);
              return;
            }

            // Find all email columns
            const headers = data[0];
            const emailColumns = findEmailColumns(headers);

            if (emailColumns.length === 0) {
              setError('No email column found. Column header must contain "email"');
              setProcessing(false);
              return;
            }

            // Extract all unique emails from all email columns
            const uniqueEmails = new Set<string>();
            data.slice(1).forEach(row => {
              emailColumns.forEach(colIndex => {
                const email = row[colIndex]?.trim();
                if (email && validateEmail(email)) {
                  uniqueEmails.add(email.toLowerCase());
                }
              });
            });

            const emailsToVerify = Array.from(uniqueEmails);
            setTotalEmails(emailsToVerify.length);
            
            // Verify emails with progress tracking
            const verificationResults = await verifyEmails(
              emailsToVerify,
              (progress) => {
                setProgress(progress);
                setVerifiedEmails(Math.floor((progress / 100) * emailsToVerify.length));
              }
            );

            // Create a map of valid emails
            const validEmailsMap = new Map(
              verificationResults
                .filter(result => result.verified)
                .map(result => [result.email.toLowerCase(), true])
            );

            // Filter rows that have at least one valid email
            const validRows = [
              headers, // Keep headers
              ...data.slice(1).filter(row => {
                return emailColumns.some(colIndex => {
                  const email = row[colIndex]?.trim().toLowerCase();
                  return email && validEmailsMap.has(email);
                });
              })
            ];

            // Calculate how long to wait to ensure minimum animation time
            const processingTime = Date.now() - startTime;
            const remainingTime = Math.max(0, minProcessingTime - processingTime);

            // Wait for the remaining time before showing results
            await new Promise(resolve => setTimeout(resolve, remainingTime));

            if (validRows.length <= 1) { // Only headers
              setError('No valid emails found in the file');
              setProcessing(false);
              return;
            }

            setResult(validRows);
            setProcessing(false);
          } catch (error) {
            console.error('Error processing results:', error);
            setError('Error processing file. Please try again.');
            setProcessing(false);
          }
        },
        error: async (error) => {
          console.error('Error parsing CSV:', error);
          
          const processingTime = Date.now() - startTime;
          const remainingTime = Math.max(0, minProcessingTime - processingTime);
          
          await new Promise(resolve => setTimeout(resolve, remainingTime));
          
          setError('Error processing file. Please try again.');
          setProcessing(false);
        }
      });
    } catch (error) {
      console.error('Error processing file:', error);
      setError('Error processing file. Please try again.');
      setProcessing(false);
    }
  };

  const validateEmail = (email: string): boolean => {
    if (!email) return false;
    // Basic email validation
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
  };

  const downloadCleanedFile = () => {
    if (!result || result.length <= 1) return; // Don't download if only headers

    try {
      // Convert the result back to CSV
      const csv = Papa.unparse(result, {
        header: false, // Headers are already in the first row
      });
      
      // Create blob and download
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      
      link.setAttribute('href', url);
      link.setAttribute('download', 'clean_leads_lists.csv');
      link.style.visibility = 'hidden';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading file:', error);
      setError('Error downloading file. Please try again.');
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile?.type === "text/csv" || selectedFile?.name.endsWith('.csv')) {
      if (credits === null || credits <= 0) {
        setError('No credits remaining. Please sign in to get more credits.');
        return;
      }
      await processFile(selectedFile);
    } else {
      setError("Please upload a CSV file");
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type === "text/csv" || droppedFile?.name.endsWith('.csv')) {
      if (credits === null || credits <= 0) {
        setError('No credits remaining. Please sign in to get more credits.');
        return;
      }
      await processFile(droppedFile);
    } else {
      setError("Please upload a CSV file");
    }
  };

  const renderProgress = () => {
    if (!processing) return null;
    
    return (
      <div className="mt-4 text-center">
        <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700 mb-2">
          <div 
            className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
            style={{ width: `${progress}%` }}
          ></div>
        </div>
        <p className="text-sm text-gray-600">
          Verified {verifiedEmails} of {totalEmails} emails ({Math.round(progress)}%)
        </p>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Auth buttons and Credits */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-2">
            <div className="bg-[#217346] bg-opacity-10 text-[#217346] px-4 py-2 rounded-lg font-medium">
              {credits !== null ? (
                <>
                  <span className="font-bold">{credits}</span>
                  {credits === 1 ? ' credit' : ' credits'} remaining
                </>
              ) : (
                'Loading credits...'
              )}
            </div>
            {!user && credits === 0 && (
              <span className="text-sm text-gray-600">
                Sign in to get 3 free credits!
              </span>
            )}
          </div>
          <div>
            {user ? (
              <div className="flex items-center gap-4">
                <span className="text-gray-600">{user.email}</span>
                <button
                  onClick={() => logout()}
                  className="text-gray-600 hover:text-gray-800"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={signInWithGoogle}
                className="bg-[#217346] text-white px-4 py-2 rounded-lg hover:bg-[#1a5c38] transition-colors"
              >
                Sign in for 3 Free Credits
              </button>
            )}
          </div>
        </div>

        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <h1 className="text-4xl font-bold mb-2">Clean Leads Lists</h1>
          </div>
          <p className="text-gray-600">Upload your CSV file with email columns to clean and verify your leads list</p>
        </div>

        <div className="bg-white rounded-3xl shadow-lg border p-0 overflow-hidden w-full max-w-2xl mx-auto">
          {processing ? (
            <div className="aspect-[4/3] bg-gray-50 relative">
              <img 
                src="/excel-animation.svg" 
                alt="Processing" 
                className="absolute inset-0 w-full h-full object-contain"
              />
              {renderProgress()}
            </div>
          ) : result ? (
            <div className="aspect-[4/3] flex items-center justify-center bg-gray-50">
              <div className="text-center px-6">
                <div className="mb-6">
                  <h3 className="text-2xl font-semibold text-gray-900 mb-2">List Cleaned!</h3>
                  <p className="text-gray-600">
                    Your email list has been cleaned and is ready for download.
                  </p>
                  {credits > 0 ? (
                    <p className="text-[#217346] mt-2">
                      You have {credits} {credits === 1 ? 'credit' : 'credits'} remaining
                    </p>
                  ) : (
                    <p className="text-[#217346] mt-2">
                      {user ? 'You have used all your credits' : 'Sign in to get 3 more free credits!'}
                    </p>
                  )}
                </div>
                <div className="space-y-4">
                  <button
                    onClick={downloadCleanedFile}
                    className="bg-[#217346] text-white px-6 py-3 rounded-lg hover:bg-[#1a5c38] transition-colors font-medium w-full"
                  >
                    Download Cleaned List
                  </button>
                  {credits > 0 && (
                    <button
                      onClick={() => {
                        setResult(null);
                        setFile(null);
                      }}
                      className="text-[#217346] border border-[#217346] px-6 py-3 rounded-lg hover:bg-gray-50 transition-colors font-medium w-full"
                    >
                      Clean Another List
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div
              className="aspect-[4/3] bg-gray-50 flex items-center justify-center cursor-pointer hover:bg-gray-100 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <div className="text-center px-6">
                <input
                  type="file"
                  id="file-input"
                  accept=".csv"
                  onChange={handleFileInput}
                  className="hidden"
                />
                <button 
                  className={`bg-[#217346] text-white px-6 py-3 rounded-lg transition-colors font-medium mb-4 ${
                    credits > 0 ? 'hover:bg-[#1a5c38]' : 'opacity-50 cursor-not-allowed'
                  }`}
                  disabled={credits === 0}
                >
                  {credits > 0 ? 'Upload CSV' : 'No Credits Remaining'}
                </button>
                {credits > 0 && (
                  <>
                    <p className="text-gray-500">or drop a file</p>
                    <p className="text-gray-400 text-sm mt-2">paste file or URL</p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 text-center space-y-2">
          <p className="text-gray-500 text-sm">
            By uploading a file, you agree to our{' '}
            <a href="/terms" className="text-[#217346] hover:underline">Terms of Service</a>
            {' '}and{' '}
            <a href="/privacy" className="text-[#217346] hover:underline">Privacy Policy</a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default EmailCleaner;