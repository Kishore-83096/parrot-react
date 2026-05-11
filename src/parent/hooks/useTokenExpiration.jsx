import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { onTokenExpired } from '../api.js';

/**
 * Hook that listens for token expiration events and navigates to welcome page
 * Should be used in a component near the top of the app hierarchy
 */
export const useTokenExpiration = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Register listener for token expiration
    const unsubscribe = onTokenExpired(() => {
      console.log('Token expired, navigating to welcome page...');
      navigate('/', { replace: true });
    });

    // Cleanup listener on unmount
    return unsubscribe;
  }, [navigate]);
};
