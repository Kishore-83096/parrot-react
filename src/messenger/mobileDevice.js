export function isRealMobileDevice() {
  const navigatorObject = globalThis.navigator;

  if (!navigatorObject) {
    return false;
  }

  if (navigatorObject.userAgentData?.mobile === true) {
    return true;
  }

  const userAgent = navigatorObject.userAgent || "";
  const platform =
    navigatorObject.userAgentData?.platform || navigatorObject.platform || "";
  const deviceText = `${platform} ${userAgent}`;

  if (
    /Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|BB10|IEMobile|Opera Mini|Mobile/i.test(
      deviceText,
    )
  ) {
    return true;
  }

  // iPadOS can present a desktop-class Macintosh user agent.
  return /Macintosh/i.test(deviceText) && Number(navigatorObject.maxTouchPoints || 0) > 1;
}
