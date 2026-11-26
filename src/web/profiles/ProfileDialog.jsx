import { useLayoutEffect, useRef } from "react";
import { setGamepadFocus } from "../../utils/gamepadSpatialNav";

export default function ProfileDialog({ label, onClose, children }) {
  const dialog = useRef(null);
  useLayoutEffect(() => {
    const node = dialog.current;
    node.showModal();
    if (node.contains(document.activeElement)) setGamepadFocus(document.activeElement, { scroll: false });
    return () => node.close();
  }, []);
  return <dialog ref={dialog} className="profile-dialog" aria-label={label} onCancel={(event) => {
    event.preventDefault();
    onClose();
  }}>{children}</dialog>;
}
