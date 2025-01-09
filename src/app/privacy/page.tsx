"use client";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 py-16">
        <h1 className="text-4xl font-bold text-gray-900 mb-8">Privacy Policy</h1>
        
        <div className="prose prose-lg">
          <p className="text-lg text-gray-600 mb-8">
            At CleanLeadsLists, we take your privacy seriously. This policy outlines how we handle your data.
          </p>
          <h2>1. Information We Collect</h2>
          <p>
            We collect the following information:
          </p>
          <ul>
            <li>IP addresses for credit management</li>
            <li>Email addresses for user authentication</li>
            <li>Usage statistics for service improvement</li>
          </ul>

          <h2>2. Email List Processing</h2>
          <p>
            When you use our email list cleaning service:
          </p>
          <ul>
            <li>Lists are processed in memory only</li>
            <li>No email data is stored permanently</li>
            <li>Processing is done securely</li>
            <li>Results are immediately deleted after download</li>
          </ul>

          <h2>3. Data Security</h2>
          <p>
            We implement security measures to maintain the safety of your information:
          </p>
          <ul>
            <li>Secure HTTPS encryption</li>
            <li>Data is processed in memory only</li>
            <li>No permanent storage of uploaded lists</li>
            <li>Regular security audits</li>
          </ul>

          <h2>4. IP Address Usage</h2>
          <p>
            We use IP addresses to:
          </p>
          <ul>
            <li>Manage the free credit system</li>
            <li>Prevent abuse of the service</li>
            <li>Ensure fair usage</li>
          </ul>

          <h2>5. User Authentication</h2>
          <p>
            For registered users:
          </p>
          <ul>
            <li>We store your email for authentication</li>
            <li>Credit balance is associated with your account</li>
            <li>No password data is stored (using Google authentication)</li>
          </ul>

          <h2>6. Cookies</h2>
          <p>
            We use essential cookies for:
          </p>
          <ul>
            <li>Authentication state management</li>
            <li>Session management</li>
            <li>Service functionality</li>
          </ul>

          <h2>7. Third-Party Services</h2>
          <p>
            We use the following third-party services:
          </p>
          <ul>
            <li>Google Authentication for user login</li>
            <li>Firebase for data storage</li>
          </ul>

          <h2>8. Your Rights</h2>
          <p>
            You have the right to:
          </p>
          <ul>
            <li>Access your personal data</li>
            <li>Request data deletion</li>
            <li>Opt out of communications</li>
          </ul>

          <div className="mt-8 text-sm text-gray-500">
            Last updated: January 8, 2025
          </div>
        </div>
      </div>
    </div>
  );
}
