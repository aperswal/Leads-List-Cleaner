import { redirect } from 'next/navigation';

export default function SuccessPage() {
  // Immediately redirect back to the main page
  redirect('/');
  
  // This won't be shown, but Next.js requires a component to return something
  return null;
}
