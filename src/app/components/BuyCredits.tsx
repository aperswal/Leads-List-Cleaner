import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { useAuth } from '../context/AuthContext';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface BuyCreditsProps {
  defaultCredits?: number;
  onClose: () => void;
  signInWithGoogle: () => void;
}

export default function BuyCredits({ defaultCredits = 100, onClose, signInWithGoogle }: BuyCreditsProps) {
  const { user } = useAuth();
  const [credits, setCredits] = useState(Math.max(100, defaultCredits));
  const [displayValue, setDisplayValue] = useState(credits.toLocaleString());
  const pricePerCredit = 0.012;
  
  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US');
  };

  const handleCreditsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Remove commas from input
    const rawValue = e.target.value.replace(/,/g, '');
    
    // Parse as number, ensuring it's at least 100
    const numericValue = Math.max(100, parseInt(rawValue) || 100);
    
    // Enforce max limit
    const finalValue = Math.min(100000, numericValue);
    
    // Update both the actual number and display value
    setCredits(finalValue);
    setDisplayValue(formatNumber(finalValue));
  };

  // Update display value when credits change
  useEffect(() => {
    setDisplayValue(formatNumber(credits));
  }, [credits]);

  const handlePurchase = async () => {
    if (!user) {
      console.error('User must be logged in to purchase credits');
      onClose();
      return;
    }

    const stripe = await stripePromise;
    
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          credits,
          pricePerCredit,
          userId: user.uid,
        }),
      });

      const session = await response.json();
      
      if (session.error) {
        console.error('Error:', session.error);
        return;
      }
      
      // Redirect to Stripe Checkout
      const result = await stripe?.redirectToCheckout({
        sessionId: session.id,
      });

      if (result?.error) {
        console.error(result.error);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4">
        {!user ? (
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-4">Sign Up Required</h2>
            <p className="text-gray-600 mb-6">
              Please sign up to get 30 free credits and unlock the ability to purchase more credits!
            </p>
            <div className="flex justify-center gap-4">
              <button
                onClick={() => {
                  onClose();
                  signInWithGoogle();
                }}
                className="bg-[#217346] text-white px-6 py-2 rounded-lg hover:bg-[#1a5c38] transition-colors"
              >
                Sign Up Now
              </button>
              <button
                onClick={onClose}
                className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">Buy Credits</h2>
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Number of Credits (minimum 100)
                </label>
                <input
                  type="text"
                  value={displayValue}
                  onChange={handleCreditsChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#217346] focus:border-transparent"
                />
                <p className="text-sm text-gray-500 mt-1">
                  Enter a number between 100 and 100,000
                </p>
              </div>

              <div className="flex justify-between text-sm text-gray-600">
                <span>Price per credit:</span>
                <span>${pricePerCredit.toFixed(3)}</span>
              </div>

              <div className="flex justify-between font-medium">
                <span>Total:</span>
                <span>${(credits * pricePerCredit).toFixed(2)}</span>
              </div>

              <button
                onClick={handlePurchase}
                className="w-full bg-[#217346] text-white py-3 rounded-lg hover:bg-[#1a5c38] transition-colors font-medium"
              >
                Purchase {formatNumber(credits)} Credits for ${(credits * pricePerCredit).toFixed(2)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
