import { useLayoutEffect, useRef } from "react";

export default function ProfileDialog({ label, onClose, children }) {
  const dialog = useRef(null);
  useLayoutEffect(() => {
    const node = dialog.current;
    node.showModal();
    return () => node.close();
  }, []);
  return <dialog ref={dialog} className="profile-dialog" aria-label={label} onCancel={(event) => {
    event.preventDefault();
    onClose();
  }}>{children}</dialog>;
}
