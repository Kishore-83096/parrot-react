/**
 * Utility function to wake up backend services from sleep
 * Calls both Parent and Messenger services to ensure they are awake
 */

const PARENT_API_BASE_URL = import.meta.env.VITE_PARENT_API_BASE_URL;
const MESSENGER_SERVICE_URL = import.meta.env.VITE_MESSENGER_SERVICE_URL;

/**
 * Calls the parent service to wake it up
 */
const wakeupParentService = async () => {
  try {
    await fetch(`${PARENT_API_BASE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    console.log('Parent service woken up successfully');
  } catch (error) {
    console.warn('Failed to wake up Parent service:', error);
    // Don't throw - we want the app to continue even if services are down
  }
};

/**
 * Calls the messenger service to wake it up
 */
const wakeupMessengerService = async () => {
  try {
    await fetch(`${MESSENGER_SERVICE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    console.log('Messenger service woken up successfully');
  } catch (error) {
    console.warn('Failed to wake up Messenger service:', error);
    // Don't throw - we want the app to continue even if services are down
  }
};

/**
 * Wakes up all backend services in parallel
 */
export const wakeupAllServices = async () => {
  try {
    await Promise.all([
      wakeupParentService(),
      wakeupMessengerService(),
    ]);
    console.log('All backend services wake-up calls initiated');
  } catch (error) {
    console.error('Error during services wake-up:', error);
  }
};
