import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/app/lib/firebase';
import { doc, runTransaction, getDoc, updateDoc } from 'firebase/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(req: Request) {
  console.log('Webhook endpoint hit');
  
  try {
    const body = await req.text();
    const headersList = headers();
    const sig = headersList.get('stripe-signature');

    console.log('Request headers:', {
      'stripe-signature': sig ? 'present' : 'missing',
      'content-type': headersList.get('content-type'),
    });

    let event: Stripe.Event;

    try {
      if (!sig || !endpointSecret) {
        console.error('Missing signature or secret');
        throw new Error('Missing stripe signature or endpoint secret');
      }
      event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
      console.log('Event constructed:', event.type);
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      return new NextResponse(
        JSON.stringify({ error: `Webhook Error: ${err.message}` }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log('Processing checkout session:', session.id);
      
      try {
        // Verify payment status
        if (session.payment_status !== 'paid') {
          console.log('Payment not completed:', {
            sessionId: session.id,
            status: session.payment_status
          });
          return new NextResponse(
            JSON.stringify({ 
              error: 'Payment not completed',
              status: session.payment_status 
            }),
            { 
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        // Verify payment intent status if available
        if (session.payment_intent) {
          const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent as string);
          if (paymentIntent.status !== 'succeeded') {
            console.log('Payment intent not succeeded:', {
              sessionId: session.id,
              paymentIntentId: paymentIntent.id,
              status: paymentIntent.status
            });
            return new NextResponse(
              JSON.stringify({ 
                error: 'Payment not succeeded',
                status: paymentIntent.status 
              }),
              { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
              }
            );
          }
        }

        const credits = session.metadata?.credits ? parseInt(session.metadata.credits) : 0;
        const userId = session.metadata?.userId;

        console.log('Session metadata:', {
          credits,
          userId,
          sessionId: session.id,
          paymentStatus: session.payment_status
        });

        if (!userId) {
          throw new Error('No user ID in session metadata');
        }

        // Get user document
        const userRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
          console.error('User not found:', userId);
          throw new Error('User document not found');
        }

        const currentCredits = userDoc.data().credits || 0;
        const newCredits = currentCredits + credits;

        console.log('Credit calculation:', {
          currentCredits,
          adding: credits,
          newTotal: newCredits
        });

        // First try direct update
        try {
          await updateDoc(userRef, {
            credits: newCredits,
            lastCreditUpdate: new Date().toISOString(),
            lastPurchase: {
              amount: credits,
              date: new Date().toISOString(),
              total: newCredits,
              sessionId: session.id,
              paymentIntentId: session.payment_intent,
              amountPaid: session.amount_total
            }
          });
          
          console.log('Direct update successful');
        } catch (updateError) {
          console.error('Direct update failed, trying transaction:', updateError);
          
          // Fallback to transaction
          await runTransaction(db, async (transaction) => {
            const freshDoc = await transaction.get(userRef);
            if (!freshDoc.exists()) {
              throw new Error('User document not found in transaction');
            }

            const currentCredits = freshDoc.data().credits || 0;
            const newCredits = currentCredits + credits;

            transaction.update(userRef, {
              credits: newCredits,
              lastCreditUpdate: new Date().toISOString(),
              lastPurchase: {
                amount: credits,
                date: new Date().toISOString(),
                total: newCredits,
                sessionId: session.id,
                paymentIntentId: session.payment_intent,
                amountPaid: session.amount_total
              }
            });
          });
          
          console.log('Transaction update successful');
        }

        // Verify the update
        const verifyDoc = await getDoc(userRef);
        console.log('Verification:', {
          finalCredits: verifyDoc.data()?.credits,
          expectedCredits: newCredits
        });

        return new NextResponse(
          JSON.stringify({ 
            success: true,
            credits: newCredits,
            userId,
            paymentStatus: session.payment_status
          }),
          { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      } catch (error: any) {
        console.error('Error processing payment:', {
          error: error.message,
          stack: error.stack
        });
        
        return new NextResponse(
          JSON.stringify({ 
            error: 'Error processing payment',
            details: error.message 
          }),
          { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    }

    return new NextResponse(
      JSON.stringify({ received: true }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error: any) {
    console.error('Webhook handler error:', {
      error: error.message,
      stack: error.stack
    });
    
    return new NextResponse(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
