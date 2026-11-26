export default function ProfileAvatar({ profile }) {
  return <span className="profile-avatar" aria-hidden="true" style={{ "--profile-color": profile.color }}>
    {Array.from(profile.name || "?")[0].toLocaleUpperCase()}
  </span>;
}
