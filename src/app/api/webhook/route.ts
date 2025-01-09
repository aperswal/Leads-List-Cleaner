import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/app/lib/firebase';
import { doc, runTransaction, getDoc } from 'firebase/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(req: Request) {
  console.log('Webhook received');
  
  try {
    const body = await req.text();
    const headersList = headers();
    const sig = headersList.get('stripe-signature');

    console.log('Headers:', {
      'stripe-signature': sig?.substring(0, 20) + '...',
    });

    let event: Stripe.Event;

    try {
      if (!sig || !endpointSecret) {
        console.error('Missing signature or secret:', { sig: !!sig, secret: !!endpointSecret });
        throw new Error('Missing stripe signature or endpoint secret');
      }
      event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
      console.log('Event constructed successfully:', event.type);
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
      console.log('Processing completed checkout:', {
        sessionId: session.id,
        metadata: session.metadata
      });
      
      try {
        // Get the credits amount from the metadata
        const credits = session.metadata?.credits ? parseInt(session.metadata.credits) : 0;
        const userId = session.metadata?.userId;

        console.log('Extracted data:', { credits, userId });

        if (!userId) {
          throw new Error('No user ID in session metadata');
        }

        // First check if user exists
        const userRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userRef);
        
        if (!userDoc.exists()) {
          console.error('User document not found:', userId);
          throw new Error('User document does not exist!');
        }

        console.log('User document found:', {
          currentCredits: userDoc.data().credits || 0
        });

        // Update user's credits in Firestore
        await runTransaction(db, async (transaction) => {
          const freshUserDoc = await transaction.get(userRef);
          const currentCredits = freshUserDoc.data()?.credits || 0;
          const newCredits = currentCredits + credits;
          
          console.log('Updating credits:', {
            currentCredits,
            addingCredits: credits,
            newTotal: newCredits
          });

          transaction.update(userRef, {
            credits: newCredits,
            lastCreditUpdate: new Date().toISOString(),
            lastPurchase: {
              amount: credits,
              date: new Date().toISOString(),
              total: newCredits,
              sessionId: session.id
            }
          });
        });

        console.log('Transaction completed successfully');
        
        return new NextResponse(
          JSON.stringify({ success: true }),
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
          JSON.stringify({ error: 'Error processing payment: ' + error.message }),
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
    console.error('Webhook error:', {
      error: error.message,
      stack: error.stack
    });
    return new NextResponse(
      JSON.stringify({ error: 'Internal server error: ' + error.message }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
