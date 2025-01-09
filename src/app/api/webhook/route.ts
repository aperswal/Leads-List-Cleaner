import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/app/lib/firebase';
import { doc, runTransaction } from 'firebase/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const headersList = headers();
    const sig = headersList.get('stripe-signature');

    let event: Stripe.Event;

    try {
      if (!sig || !endpointSecret) {
        throw new Error('Missing stripe signature or endpoint secret');
      }
      event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      return NextResponse.json(
        { error: `Webhook Error: ${err.message}` },
        { status: 400 }
      );
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      
      try {
        // Get the credits amount from the metadata
        const credits = session.metadata?.credits ? parseInt(session.metadata.credits) : 0;
        const userId = session.metadata?.userId;

        if (!userId) {
          throw new Error('No user ID in session metadata');
        }

        // Update user's credits in Firestore
        const userRef = doc(db, 'users', userId);
        
        await runTransaction(db, async (transaction) => {
          const userDoc = await transaction.get(userRef);
          
          if (!userDoc.exists()) {
            throw new Error('User document does not exist!');
          }

          const currentCredits = userDoc.data().credits || 0;
          
          transaction.update(userRef, {
            credits: currentCredits + credits,
          });
        });

        console.log(`Successfully added ${credits} credits to user ${userId}`);
      } catch (error) {
        console.error('Error processing successful payment:', error);
        return NextResponse.json(
          { error: 'Error processing payment' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
