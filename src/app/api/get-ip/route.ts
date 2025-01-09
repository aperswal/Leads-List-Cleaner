import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    // Get IP from request headers
    const forwardedFor = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const cfIp = request.headers.get('cf-connecting-ip');
    
    // Use the first available IP
    const ip = realIp || 
               (forwardedFor ? forwardedFor.split(',')[0] : undefined) ||
               cfIp ||
               '127.0.0.1';  // Fallback for local development

    console.log('IP address detected:', ip);
    
    if (!ip) {
      console.error('No IP address found in headers');
      return NextResponse.json({ error: 'Could not detect IP address' }, { status: 400 });
    }

    // For IPv6 localhost, convert to IPv4
    const normalizedIp = ip === '::1' ? '127.0.0.1' : ip;

    return NextResponse.json({ ip: normalizedIp });
  } catch (error) {
    console.error('Error getting IP address:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
