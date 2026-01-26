
import React from 'react';
import { Button } from '@/components/ui/button';

const base64ToBlob = (base64, mime) => {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mime });
};

const AddToWalletButton = ({ passType, pkPass, jwt, className }) => {
  const handleAppleClick = () => {
    if (!pkPass) return;
    const blob = base64ToBlob(pkPass, 'application/vnd.apple.pkpass');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pass.pkpass';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleGoogleClick = () => {
    if (!jwt) return;
    window.location.href = `https://pay.google.com/gp/v/save/${jwt}`;
  };

  if (passType === 'apple') {
    return (
      <Button
        onClick={handleAppleClick}
        disabled={!pkPass}
        className={`w-full bg-black hover:bg-gray-800 text-white py-3 px-4 text-lg flex items-center justify-center ${className}`}
        aria-label="Add to Apple Wallet"
      >
        <img src="https://apple-resources.s3.amazonaws.com/media-kits/wallet/add-to-apple-wallet-logo-white.svg" alt="" className="h-8" />
      </Button>
    );
  }

  if (passType === 'google') {
    return (
      <Button
        onClick={handleGoogleClick}
        disabled={!jwt}
        className={`w-full bg-black hover:bg-gray-800 text-white py-3 px-4 text-lg flex items-center justify-center ${className}`}
        aria-label="Add to Google Wallet"
      >
        <img src="https://storage.googleapis.com/wallet-lab-tools-codelabs-artifacts/google-wallet-button.svg" alt="" className="h-9" />
      </Button>
    );
  }

  return null;
};

export default AddToWalletButton;
