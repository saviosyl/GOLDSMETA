import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";

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
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.listAdminUsers();
      setUsers(res.users as AdminUser[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load users");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (userId: string, action: "approve" | "reject" | "suspend" | "restore") => {
    setBusyId(`${userId}:${action}`);
    setError(null);
    try {
      await api.adminUserAction(userId, action);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  if (account && account.role !== "OWNER" && account.role !== "ADMIN") {
    return (
      <div className="gm-section" data-testid="admin-users-forbidden">
        <h2 className="gm-section-title">Admin</h2>
        <p className="gm-meta">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="gm-section" data-testid="admin-users-page">
      <h2 className="gm-section-title">User approval centre</h2>
      <p className="gm-meta">
        Approve or suspend registered users. OWNER promotion and pinned-owner changes are forbidden.
      </p>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      <div className="gm-table-wrap">
        <table className="gm-table" data-testid="admin-users-table">
          <thead>
            <tr>
              <th>User ID</th>
              <th>Name</th>
              <th>Email</th>
              <th>Registered</th>
              <th>Verified</th>
              <th>Status</th>
              <th>Last sign-in</th>
              <th>Actions</th>
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
                <td>
                  {u.approvalStatus}
                  {u.suspended ? " / suspended" : ""}
                </td>
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
    </div>
  );
}
