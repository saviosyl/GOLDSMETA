import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { approvalStatusLabel, roleLabel } from "../../lib/plainLanguage";
import { describeClientError } from "../../lib/errors";
import { FriendlyErrorBanner } from "../../components/FriendlyErrorBanner";

type AdminUser = {
  userId: string;
  userIdMasked: string;
  firstName: string;
  lastName: string;
  email: string;
  registeredAt: string;
  emailVerified: boolean;
  approvalStatus: string;
  role: string;
  lastSignInAt: string | null;
  suspended: boolean;
};

export function AdminUsersPage() {
  const { api, account } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [errorDetail, setErrorDetail] = useState<ReturnType<typeof describeClientError> | null>(
    null
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErrorDetail(null);
    try {
      const res = await api.listAdminUsers();
      setUsers(res.users as AdminUser[]);
    } catch (err) {
      setErrorDetail(describeClientError(err, "Unable to load users"));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (userId: string, action: "approve" | "reject" | "suspend" | "restore") => {
    setBusyId(`${userId}:${action}`);
    setErrorDetail(null);
    try {
      await api.adminUserAction(userId, action);
      await load();
    } catch (err) {
      setErrorDetail(describeClientError(err, "Action failed"));
    } finally {
      setBusyId(null);
    }
  };

  if (account && account.role !== "OWNER" && account.role !== "ADMIN") {
    return (
      <div className="gm-section" data-testid="admin-users-forbidden">
        <h2 className="gm-section-title">Admin</h2>
        <p className="gm-meta">You do not have access to this feature yet.</p>
      </div>
    );
  }

  return (
    <div className="gm-section gm-admin-users-page" data-testid="admin-users-page">
      <h2 className="gm-section-title">User approval centre</h2>
      <p className="gm-meta">
        Approve or pause registered users. Owner promotion and pinned-owner changes are not available
        here.
      </p>
      {errorDetail && (
        <FriendlyErrorBanner detail={errorDetail} onRetry={() => void load()} testId="admin-error" />
      )}
      <div className="gm-table-wrap">
        <table className="gm-table" data-testid="admin-users-table">
          <thead>
            <tr>
              <th scope="col">User ID</th>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Registered</th>
              <th scope="col">Verified</th>
              <th scope="col">Status</th>
              <th scope="col">Role</th>
              <th scope="col">Last sign-in</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.userId}>
                <td>{u.userIdMasked}</td>
                <td>
                  {u.firstName} {u.lastName}
                </td>
                <td>{u.email}</td>
                <td>{u.registeredAt ? new Date(u.registeredAt).toLocaleString() : "—"}</td>
                <td>{u.emailVerified ? "Yes" : "No"}</td>
                <td data-testid={`admin-status-${u.userIdMasked}`}>
                  {u.suspended
                    ? "Suspended"
                    : approvalStatusLabel(u.approvalStatus)}
                </td>
                <td>{roleLabel(u.role)}</td>
                <td>{u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString() : "—"}</td>
                <td className="gm-admin-actions">
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void act(u.userId, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void act(u.userId, "reject")}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void act(u.userId, "suspend")}
                  >
                    Suspend
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void act(u.userId, "restore")}
                  >
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile-friendly card list */}
      <ul className="gm-admin-cards" data-testid="admin-users-cards">
        {users.map((u) => (
          <li key={`card-${u.userId}`} className="gm-admin-card">
            <strong>
              {u.firstName} {u.lastName}
            </strong>
            <span className="gm-meta">{u.email}</span>
            <span className="gm-meta">{u.userIdMasked}</span>
            <span>
              {u.suspended ? "Suspended" : approvalStatusLabel(u.approvalStatus)} ·{" "}
              {roleLabel(u.role)}
            </span>
            <span className="gm-meta">
              Registered {u.registeredAt ? new Date(u.registeredAt).toLocaleDateString() : "—"}
            </span>
            <div className="gm-admin-actions">
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => void act(u.userId, "approve")}
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => void act(u.userId, "reject")}
              >
                Reject
              </button>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => void act(u.userId, "suspend")}
              >
                Suspend
              </button>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => void act(u.userId, "restore")}
              >
                Restore
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
