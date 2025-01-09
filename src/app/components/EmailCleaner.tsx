"use client";

import React, { useState, useEffect } from 'react';
import { Upload } from 'lucide-react';
import Papa from 'papaparse';
import { useAuth } from '../context/AuthContext';
import { doc, getDoc, setDoc, increment, collection, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { verifyEmail, verifyEmails } from '../lib/emailVerifier';
import BuyCredits from './BuyCredits';

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
  const [uniqueEmailCount, setUniqueEmailCount] = useState<number>(0);
  const [showCreditCheck, setShowCreditCheck] = useState<boolean>(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showBuyCredits, setShowBuyCredits] = useState<boolean>(false);
  const [neededCredits, setNeededCredits] = useState<number>(0);
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
    const fetchCredits = async () => {
      try {
        if (user) {
          const userRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userRef);
          
          if (!userDoc.exists()) {
            // New user - give them 30 free credits
            await setDoc(userRef, {
              credits: 30,
              email: user.email,
              name: user.displayName,
              createdAt: new Date().toISOString()
            });
            setCredits(30);
          } else {
            setCredits(userDoc.data().credits || 0);
          }
        } else {
          // Anonymous user - give them 5 free credits based on IP
          const ipRef = doc(db, 'anonymous_users', userIP || 'unknown');
          const ipDoc = await getDoc(ipRef);
          
          if (!ipDoc.exists()) {
            await setDoc(ipRef, {
              credits: 5,
              createdAt: new Date().toISOString()
            });
            setCredits(5);
          } else {
            setCredits(ipDoc.data().credits || 0);
          }
        }
      } catch (error) {
        console.error('Error fetching credits:', error);
        setCredits(0);
      }
    };

    if (userIP || user) {
      fetchCredits();
    }
  }, [user, userIP]);

  const useCredit = async () => {
    try {
      if (credits === null || credits <= 0) {
        setError(user ? 'No credits remaining.' : 'No credits remaining. Sign in to get 30 free credits!');
        return false;
      }

      if (user) {
        const userRef = doc(db, 'users', user.uid);
        await runTransaction(db, async (transaction) => {
          const userDoc = await transaction.get(userRef);
          if (!userDoc.exists()) {
            throw new Error('User document not found');
          }
          
          const currentCredits = userDoc.data().credits;
          if (currentCredits <= 0) {
            throw new Error('No credits remaining');
          }
          
          transaction.update(userRef, {
            credits: currentCredits - 1
          });
        });
      } else if (userIP) {
        const ipRef = doc(db, 'anonymous_users', userIP);
        await runTransaction(db, async (transaction) => {
          const ipDoc = await transaction.get(ipRef);
          if (!ipDoc.exists()) {
            throw new Error('IP document not found');
          }
          
          const currentCredits = ipDoc.data().credits;
          if (currentCredits <= 0) {
            throw new Error('No credits remaining');
          }
          
          transaction.update(ipRef, {
            credits: currentCredits - 1
          });
        });
      }

      setCredits(prev => prev !== null ? prev - 1 : 0);
      return true;
    } catch (error) {
      console.error('Error using credit:', error);
      setError('Error processing credits. Please try again.');
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
    try {
      setProcessing(true);
      setProgress(0);
      setError(null);

      // Process the file
      Papa.parse(file, {
        header: false,
        complete: async (results) => {
          try {
            const data = results.data as string[][];
            if (data.length < 2) {
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
            
            // Check if user has enough credits
            if (credits === null || credits < emailsToVerify.length) {
              const remaining = credits || 0;
              const needed = emailsToVerify.length;
              if (user) {
                setError(`Not enough credits. You need ${needed} credits but have ${remaining} remaining.`);
              } else {
                setError(`Not enough credits. Sign in to get 30 free credits! (Need: ${needed}, Have: ${remaining})`);
              }
              setProcessing(false);
              return;
            }

            setTotalEmails(emailsToVerify.length);
            let verifiedCount = 0;
            const verificationResults = [];

            // Process emails one by one to ensure credit usage
            for (const email of emailsToVerify) {
              const creditUsed = await useCredit();
              if (!creditUsed) {
                setError('Credit usage failed. Please try again.');
                setProcessing(false);
                return;
              }

              try {
                const result = await verifyEmail(email);
                verificationResults.push(result);
                verifiedCount++;
                setVerifiedEmails(verifiedCount);
                setProgress((verifiedCount / emailsToVerify.length) * 100);
              } catch (error) {
                console.error('Error verifying email:', email, error);
                verificationResults.push({
                  email,
                  syntax: false,
                  disposable: true,
                  mxRecord: false,
                  smtp: false,
                  verified: false
                });
              }
            }

            // Create a map of valid emails
            const validEmailsMap = new Map(
              verificationResults
                .filter(result => result.verified)
                .map(result => [result.email.toLowerCase(), true])
            );

            // Filter rows that have at least one valid email
            const validRows = [
              headers,
              ...data.slice(1).filter(row => {
                return emailColumns.some(colIndex => {
                  const email = row[colIndex]?.trim().toLowerCase();
                  return email && validEmailsMap.has(email);
                });
              })
            ];

            if (validRows.length <= 1) {
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
        error: (error) => {
          console.error('Error parsing CSV:', error);
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

  const checkCredits = async (file: File) => {
    try {
      Papa.parse(file, {
        header: false,
        complete: async (results) => {
          const data = results.data as string[][];
          if (data.length < 2) {
            setError('CSV file is empty');
            return;
          }

          // Find all email columns
          const headers = data[0];
          const emailColumns = findEmailColumns(headers);

          if (emailColumns.length === 0) {
            setError('No email column found. Column header must contain "email"');
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

          const emailCount = uniqueEmails.size;
          setUniqueEmailCount(emailCount);
          setPendingFile(file);
          setShowCreditCheck(true);
        },
        error: (error) => {
          console.error('Error parsing CSV:', error);
          setError('Error processing file. Please try again.');
        }
      });
    } catch (error) {
      console.error('Error checking credits:', error);
      setError('Error processing file. Please try again.');
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFile(file);
    setError(null);
    setResult(null);
    setProgress(0);
    setVerifiedEmails(0);
    setTotalEmails(0);
    setShowCreditCheck(false);
    setPendingFile(null);
    
    await checkCredits(file);
  };

  const startProcessing = async () => {
    if (!pendingFile) return;
    setShowCreditCheck(false);
    await processFile(pendingFile);
  };

  const cancelProcessing = () => {
    setShowCreditCheck(false);
    setPendingFile(null);
    setFile(null);
    setUniqueEmailCount(0);
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

  const resetState = () => {
    setFile(null);
    setError(null);
    setResult(null);
    setProgress(0);
    setVerifiedEmails(0);
    setTotalEmails(0);
    setShowCreditCheck(false);
    setPendingFile(null);
    setUniqueEmailCount(0);
  };

  return (
    <div className="min-h-screen bg-gray-100 py-12">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Auth buttons and Credits */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-4">
            <div className="text-sm">
              {credits !== null && (
                <div className="flex items-center gap-2">
                  <span>{credits} credits remaining</span>
                  {user && (
                    <button
                      onClick={() => setShowBuyCredits(true)}
                      className="text-[#217346] hover:text-[#1a5c38] font-medium"
                    >
                      Buy Credits
                    </button>
                  )}
                </div>
              )}
            </div>
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
                Sign in for 30 Free Credits
              </button>
            )}
          </div>
        </div>

        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <h1 className="text-4xl font-bold mb-2">Clean Leads Lists</h1>
          </div>
          <p className="text-gray-600">Upload your CSV file with email columns to clean and verify your leads list</p>
          {credits !== null && (
            <div className="mt-4">
              <span className="font-semibold">{credits}</span> {credits === 1 ? 'credit' : 'credits'} remaining
              {!user && credits === 0 && (
                <div className="mt-2 text-[#217346]">
                  Sign in to get 30 free credits!
                </div>
              )}
              {!user && credits > 0 && (
                <div className="mt-2 text-gray-500">
                  Sign in to get 25 more free credits!
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-white rounded-3xl shadow-lg border p-0 overflow-hidden w-full max-w-2xl mx-auto">
          {/* Results Screen */}
          {!processing && result && (
            <div className="p-8 text-center">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Processing Complete!</h2>
                <p className="text-gray-600">
                  Found {result.length - 1} valid email{result.length === 2 ? '' : 's'}
                </p>
                {credits !== null && (
                  <p className="text-gray-500 mt-2">
                    {credits} credit{credits === 1 ? '' : 's'} remaining
                  </p>
                )}
              </div>

              <div className="flex justify-center gap-4">
                <button
                  onClick={downloadCleanedFile}
                  className="bg-[#217346] text-white px-6 py-2 rounded-lg hover:bg-[#1a5c38] transition-colors"
                >
                  Download Cleaned CSV
                </button>
                <button
                  onClick={resetState}
                  className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Process Another File
                </button>
              </div>
            </div>
          )}

          {/* Credit Check Modal */}
          {showCreditCheck && !result && (
            <div className="p-8 text-center">
              <h2 className="text-2xl font-bold mb-4">Credit Check</h2>
              <p className="mb-4">
                You have <span className="font-bold">{credits}</span> credits available
              </p>
              <p className="mb-4">
                This file contains <span className="font-bold">{uniqueEmailCount}</span> unique emails to verify
              </p>
              {credits !== null && credits < uniqueEmailCount ? (
                <div className="mb-4">
                  <p className="text-red-500 font-bold mb-6">
                    You need {uniqueEmailCount - credits} more credits
                  </p>
                  {!user ? (
                    <div className="space-y-4">
                      <p className="text-gray-700">
                        Sign up now to get 30 free credits and unlock the ability to purchase more!
                      </p>
                      <div className="flex justify-center gap-4">
                        <button
                          onClick={signInWithGoogle}
                          className="bg-[#217346] text-white px-6 py-2 rounded-lg hover:bg-[#1a5c38] transition-colors"
                        >
                          Sign Up for 30 Free Credits
                        </button>
                        <button
                          onClick={cancelProcessing}
                          className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-300 transition-colors"
                        >
                          Go Back
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-center gap-4">
                      <button
                        onClick={() => {
                          setNeededCredits(uniqueEmailCount - credits);
                          setShowBuyCredits(true);
                        }}
                        className="bg-[#217346] text-white px-6 py-2 rounded-lg hover:bg-[#1a5c38] transition-colors"
                      >
                        Buy Credits
                      </button>
                      <button
                        onClick={cancelProcessing}
                        className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-300 transition-colors"
                      >
                        Go Back
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex justify-center gap-4">
                  <button
                    onClick={startProcessing}
                    className="bg-[#217346] text-white px-6 py-2 rounded-lg hover:bg-[#1a5c38] transition-colors"
                  >
                    Start Processing
                  </button>
                  <button
                    onClick={cancelProcessing}
                    className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Processing Animation */}
          {processing && (
            <div className="aspect-[4/3] bg-gray-50 relative">
              <img 
                src="/excel-animation.svg" 
                alt="Processing" 
                className="absolute inset-0 w-full h-full object-contain"
              />
              {renderProgress()}
            </div>
          )}

          {/* File Upload Area */}
          {!showCreditCheck && !processing && !result && (
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

        {/* Buy Credits Modal */}
        {showBuyCredits && (
          <BuyCredits
            defaultCredits={neededCredits || 100}
            onClose={() => setShowBuyCredits(false)}
            signInWithGoogle={signInWithGoogle}
          />
        )}

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