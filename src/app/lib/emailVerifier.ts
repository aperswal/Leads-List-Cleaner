interface VerificationResult {
  email: string;
  syntax: boolean;
  disposable: boolean;
  mxRecord: boolean;
  smtp: boolean;
  verified: boolean;
}

interface VerificationResponse {
  result: VerificationResult;
}

const API_CONFIG = {
  BASE_URL: 'https://trgiqyj4m6.execute-api.us-east-1.amazonaws.com/dev',
  ENDPOINT: '/verify',
  MAX_RETRIES: 3,
  TIMEOUT: 10000, // 10 seconds
  BATCH_SIZE: 10,
};

export class RateLimitError extends Error {
  constructor(message = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
  }
}

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function verifyEmailWithRetry(
  email: string, 
  retries = API_CONFIG.MAX_RETRIES
): Promise<VerificationResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT);

    const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 429) {
      throw new RateLimitError();
    }

    if (!response.ok) {
      throw new Error(`Verification failed: ${response.statusText}`);
    }

    const data: VerificationResponse = await response.json();
    return data.result;
  } catch (error) {
    if (error instanceof RateLimitError) {
      if (retries > 0) {
        await wait(2000); // Wait 2 seconds before retrying
        return verifyEmailWithRetry(email, retries - 1);
      }
    }

    if (error.name === 'AbortError') {
      throw new Error('Verification timeout');
    }

    console.error('Email verification error:', error);
    throw error;
  }
}

export async function verifyEmails(
  emails: string[], 
  onProgress?: (progress: number) => void
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  const totalEmails = emails.length;

  // Process emails in batches
  for (let i = 0; i < emails.length; i += API_CONFIG.BATCH_SIZE) {
    const batch = emails.slice(i, i + API_CONFIG.BATCH_SIZE);
    const batchPromises = batch.map(email => 
      verifyEmailWithRetry(email)
        .catch(error => ({
          email,
          syntax: false,
          disposable: true,
          mxRecord: false,
          smtp: false,
          verified: false,
        }))
    );

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Report progress
    if (onProgress) {
      const progress = Math.min(((i + API_CONFIG.BATCH_SIZE) / totalEmails) * 100, 100);
      onProgress(progress);
    }

    // Add a small delay between batches to avoid rate limiting
    if (i + API_CONFIG.BATCH_SIZE < totalEmails) {
      await wait(500); // 500ms delay between batches
    }
  }

  return results;
}

export async function verifyEmail(email: string): Promise<VerificationResult> {
  return verifyEmailWithRetry(email);
}
