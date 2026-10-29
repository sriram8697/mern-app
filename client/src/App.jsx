import { useEffect, useMemo, useState } from 'react'
import './App.css'

const categories = ['All recipes', 'Breakfast', 'Lunch', 'Dinner']
const maxRecipePhotoSize = 4 * 1024 * 1024

// Shared helpers
function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read that image.'))
    reader.readAsDataURL(file)
  })
}

function recipeImageUrl(image, width = 900, fit = 'crop') {
  if (!image) return ''
  if (image?.startsWith('data:image/')) return image
  if (/^https?:\/\//i.test(image || '')) return image
  return `https://images.unsplash.com/${image}?auto=format&fit=${fit}&w=${width}&q=85`
}

function App() {
  // Page and account state
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All recipes')
  const [recipes, setRecipes] = useState([])
  const [recipeLoading, setRecipeLoading] = useState(true)
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem('savorFavorites')) || [] } catch { return [] }
  })
  const [showSaved, setShowSaved] = useState(false)
  const [selected, setSelected] = useState(null)
  const [authMode, setAuthMode] = useState(null)
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [adminPanel, setAdminPanel] = useState(false)
  const [adminTab, setAdminTab] = useState('users')
  const [adminUsers, setAdminUsers] = useState([])
  const [adminLogs, setAdminLogs] = useState([])
  const [pendingRecipes, setPendingRecipes] = useState([])
  const [publishedRecipes, setPublishedRecipes] = useState([])
  const [adminBusy, setAdminBusy] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [recipeSubmissionOpen, setRecipeSubmissionOpen] = useState(false)
  const [recipeSubmissionBusy, setRecipeSubmissionBusy] = useState(false)
  const [recipeSubmissionError, setRecipeSubmissionError] = useState('')
  const [recipeSubmissionNotice, setRecipeSubmissionNotice] = useState('')
  const [recipePhotoPreview, setRecipePhotoPreview] = useState('')
  const [newsletterEmail, setNewsletterEmail] = useState('')
  const [newsletterBusy, setNewsletterBusy] = useState(false)
  const [newsletterMessage, setNewsletterMessage] = useState('')
  const [newsletterError, setNewsletterError] = useState('')
  const [editingRecipeId, setEditingRecipeId] = useState(null)
  const [editingRecipePhotoPreview, setEditingRecipePhotoPreview] = useState('')
  const [editingRecipeError, setEditingRecipeError] = useState('')
  const [notifications, setNotifications] = useState([])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('savorUser')) } catch { return null }
  })

  // Data loading and global page effects
  useEffect(() => {
    localStorage.setItem('savorFavorites', JSON.stringify(saved))
  }, [saved])

  const loadCommunityRecipes = async () => {
    try {
      const response = await fetch('/api/recipes')
      if (!response.ok) return
      const data = await response.json()
      const communityRecipes = data.recipes.map((recipe) => ({
        ...recipe,
        image: recipe.seedKey === 'hyderabadi-chicken-dum-biryani'
          ? 'photo-1563379091339-03b21ab4a4f8'
          : recipe.image,
        id: recipe._id,
        rating: recipe.rating ?? 5,
        tags: recipe.tags?.length ? recipe.tags : ['Community recipe'],
      }))
      setRecipes(communityRecipes)
    } catch {
      // Keep the list empty and let the page show its empty state if the API is unavailable.
    } finally {
      setRecipeLoading(false)
    }
  }

  useEffect(() => { loadCommunityRecipes() }, [])

  useEffect(() => {
    const token = localStorage.getItem('savorToken')
    if (!token) return
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => { setUser(data.user); localStorage.setItem('savorUser', JSON.stringify(data.user)) })
      .catch(() => { localStorage.removeItem('savorToken'); localStorage.removeItem('savorUser'); setUser(null) })
  }, [])

  useEffect(() => {
    if (!user?.id || notificationsOpen) return undefined
    let cancelled = false
    const loadNotifications = async () => {
      try {
        const response = await fetch('/api/notifications', { headers: { Authorization: `Bearer ${localStorage.getItem('savorToken')}` } })
        if (!response.ok) return
        const data = await response.json()
        if (cancelled) return
        setNotifications(data.notifications)
        if (data.notifications.length) setNotificationsOpen(true)
      } catch {
        // Retry on the next poll while the user remains signed in.
      }
    }
    loadNotifications()
    const timer = window.setInterval(loadNotifications, 15000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [user?.id, notificationsOpen])

  useEffect(() => {
    const body = document.body
    const root = document.documentElement
    const savedScrollY = window.scrollY
    const previous = {
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      bodyOverflow: body.style.overflow,
      rootOverflow: root.style.overflow,
    }
    const modalOpen = Boolean(selected || authMode || adminPanel || recipeSubmissionOpen || notificationsOpen)
    if (!modalOpen) return undefined
    body.style.position = 'fixed'
    body.style.top = `-${savedScrollY}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    root.style.overflow = 'hidden'
    return () => {
      body.style.position = previous.bodyPosition
      body.style.top = previous.bodyTop
      body.style.width = previous.bodyWidth
      body.style.overflow = previous.bodyOverflow
      root.style.overflow = previous.rootOverflow
      window.scrollTo(0, savedScrollY)
    }
  }, [selected, authMode, adminPanel, recipeSubmissionOpen, notificationsOpen])

  // Authentication and notifications
  const submitAuth = async (event) => {
    event.preventDefault()
    setAuthError('')
    const form = new FormData(event.currentTarget)
    const payload = Object.fromEntries(form.entries())
    if (authMode === 'signup' && !/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/.test(payload.password)) {
      setAuthError('Use at least 8 characters, including a letter, a number, and a symbol.')
      return
    }
    setAuthBusy(true)
    try {
      const response = await fetch(`/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Could not sign you in.')
      localStorage.setItem('savorToken', data.token)
      localStorage.setItem('savorUser', JSON.stringify(data.user))
      setUser(data.user)
      setAuthMode(null)
      if (data.user.role === 'admin') {
        const pending = await loadAdminData()
        setAdminTab(pending?.length ? 'recipes' : 'logs')
      }
    } catch (error) {
      setAuthError(error.message === 'Failed to fetch' ? 'Could not reach the account service. Start the backend and configure its database.' : error.message)
    } finally {
      setAuthBusy(false)
    }
  }

  const signOut = () => {
    localStorage.removeItem('savorToken')
    localStorage.removeItem('savorUser')
    setUser(null)
    setNotifications([])
    setNotificationsOpen(false)
  }

  const dismissNotifications = async () => {
    const token = localStorage.getItem('savorToken')
    await Promise.allSettled(notifications.map((item) => fetch(`/api/notifications/${item._id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    })))
    setNotifications([])
    setNotificationsOpen(false)
  }

  const subscribeToNewsletter = async (event) => {
    event.preventDefault()
    setNewsletterBusy(true)
    setNewsletterMessage('')
    setNewsletterError('')
    try {
      const response = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newsletterEmail }),
      })
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('The newsletter API is not available. Restart the server in mern-app/server and try again.')
      }
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Could not save your subscription.')
      setNewsletterMessage(data.message)
      setNewsletterEmail('')
    } catch (error) {
      setNewsletterError(error.message === 'Failed to fetch' ? 'Could not reach the newsletter service. Please try again.' : error.message)
    } finally {
      setNewsletterBusy(false)
    }
  }

  // Admin data and actions
  const loadAdminData = async () => {
    setAdminPanel(true)
    setAdminBusy(true)
    setAdminError('')
    try {
      const headers = { Authorization: `Bearer ${localStorage.getItem('savorToken')}` }
      const [usersResponse, logsResponse, recipesResponse, publishedResponse] = await Promise.all([
        fetch('/api/admin/users', { headers }),
        fetch('/api/admin/logs', { headers }),
        fetch('/api/admin/recipes/pending', { headers }),
        fetch('/api/admin/recipes/published', { headers }),
      ])
      const [usersData, logsData, recipesData, publishedData] = await Promise.all([usersResponse.json(), logsResponse.json(), recipesResponse.json(), publishedResponse.json()])
      if (!usersResponse.ok) throw new Error(usersData.message || 'Could not load users.')
      if (!logsResponse.ok) throw new Error(logsData.message || 'Could not load sign-in activity.')
      if (!recipesResponse.ok) throw new Error(recipesData.message || 'Could not load pending recipes.')
      if (!publishedResponse.ok) throw new Error(publishedData.message || 'Could not load published recipes.')
      setAdminUsers(usersData.users)
      setAdminLogs(logsData.logs)
      setPendingRecipes(recipesData.recipes)
      setPublishedRecipes(publishedData.recipes)
      return recipesData.recipes
    } catch (error) {
      setAdminError(error.message === 'Failed to fetch' ? 'Could not reach the admin service. Check that the backend is running.' : error.message)
      return []
    } finally {
      setAdminBusy(false)
    }
  }

  // Recipe submission and photo handling
  const openRecipeSubmission = () => {
    setRecipeSubmissionNotice('')
    setRecipeSubmissionError('')
    setRecipePhotoPreview('')
    if (!user) {
      setAuthError('Log in or create an account to submit a recipe for review.')
      setAuthMode('login')
      return
    }
    setRecipeSubmissionOpen(true)
  }

  const chooseRecipePhoto = async (event, setPreview, setError) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    setError('')
    if (!file) {
      setPreview('')
      return
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > maxRecipePhotoSize) {
      setError('Choose a PNG, JPEG, or WebP photo smaller than 4 MB.')
      setPreview('')
      input.value = ''
      return
    }
    try {
      setPreview(await readImageFile(file))
    } catch (error) {
      setError(error.message)
      input.value = ''
    }
  }

  const submitRecipe = async (event) => {
    event.preventDefault()
    const formElement = event.currentTarget
    setRecipeSubmissionBusy(true)
    setRecipeSubmissionError('')
    const form = new FormData(event.currentTarget)
    const payload = {
      name: form.get('recipeName'),
      category: form.get('recipeCategory'),
      time: Number(form.get('recipeTime')),
      description: form.get('recipeDescription'),
      ingredients: String(form.get('recipeIngredients')).split('\n'),
    }
    try {
      const photo = form.get('recipePhoto')
      if (photo?.size) payload.image = await readImageFile(photo)
      const response = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('savorToken')}` },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Could not submit this recipe.')
      setRecipeSubmissionOpen(false)
      setRecipeSubmissionNotice('Thanks! Your recipe was sent to the admin for review.')
      setRecipePhotoPreview('')
      formElement.reset()
    } catch (error) {
      setRecipeSubmissionError(error.message === 'Failed to fetch' ? 'Could not reach the recipe service. Please try again.' : error.message)
    } finally {
      setRecipeSubmissionBusy(false)
    }
  }

  // Admin review and account management
  const reviewRecipe = async (id, decision) => {
    setAdminBusy(true)
    setAdminError('')
    try {
      const response = await fetch(`/api/admin/recipes/${id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('savorToken')}` },
        body: JSON.stringify({ decision }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Could not review this recipe.')
      if (decision === 'approved') await loadCommunityRecipes()
      await loadAdminData()
      setAdminTab('recipes')
    } catch (error) {
      setAdminError(error.message === 'Failed to fetch' ? 'Could not reach the admin service.' : error.message)
    } finally {
      setAdminBusy(false)
    }
  }

  const saveRecipeEdits = async (event, recipe) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setAdminBusy(true)
    setEditingRecipeError('')
    try {
      const photo = form.get('adminRecipePhoto')
      const payload = {
        name: form.get('adminRecipeName'),
        category: form.get('adminRecipeCategory'),
        time: Number(form.get('adminRecipeTime')),
        description: form.get('adminRecipeDescription'),
        ingredients: String(form.get('adminRecipeIngredients')).split('\n'),
      }
      if (photo?.size) payload.image = await readImageFile(photo)
      const response = await fetch(`/api/admin/recipes/${recipe._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('savorToken')}` },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Could not update this recipe.')
      setEditingRecipeId(null)
      setEditingRecipePhotoPreview('')
      if (recipe.status === 'approved') await loadCommunityRecipes()
      await loadAdminData()
    } catch (error) {
      setEditingRecipeError(error.message === 'Failed to fetch' ? 'Could not reach the admin service.' : error.message)
    } finally {
      setAdminBusy(false)
    }
  }

  const openAdminPanel = async () => {
    const pending = await loadAdminData()
    setAdminTab(pending.length ? 'recipes' : 'logs')
  }

  const setAccountActive = async (account, isActive) => {
    setAdminBusy(true)
    setAdminError('')
    try {
      const response = await fetch(`/api/admin/users/${account._id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('savorToken')}` },
        body: JSON.stringify({ isActive }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Could not update this account.')
      await loadAdminData()
      setAdminTab('users')
    } catch (error) {
      setAdminError(error.message === 'Failed to fetch' ? 'Could not reach the admin service.' : error.message)
    } finally {
      setAdminBusy(false)
    }
  }

  const removeAccount = async (account) => {
    const confirmed = window.confirm(`Permanently remove ${account.email}, their submitted recipes, and their activity logs?`)
    if (!confirmed) return
    setAdminBusy(true)
    setAdminError('')
    try {
      const response = await fetch(`/api/admin/users/${account._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('savorToken')}` },
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Could not remove this account.')
      await loadAdminData()
      setAdminTab('users')
    } catch (error) {
      setAdminError(error.message === 'Failed to fetch' ? 'Could not reach the admin service.' : error.message)
    } finally {
      setAdminBusy(false)
    }
  }

  const removeRecipe = async (recipe, returnTab = 'published') => {
    if (!window.confirm(`Remove “${recipe.name}” from Savor? The author will be notified.`)) return
    setAdminBusy(true)
    setAdminError('')
    try {
      const response = await fetch(`/api/admin/recipes/${recipe._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('savorToken')}` },
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Could not remove this recipe.')
      await loadAdminData()
      setAdminTab(returnTab)
    } catch (error) {
      setAdminError(error.message === 'Failed to fetch' ? 'Could not reach the admin service.' : error.message)
    } finally {
      setAdminBusy(false)
    }
  }

  // Admin dashboard content
  const renderAdminContent = () => {
    if (adminError) return <div className="admin-error" role="alert">{adminError}</div>
    if (adminBusy) return <div className="admin-empty">Loading admin data…</div>
    if (adminTab === 'users') {
      return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead><tbody>{adminUsers.map((entry) => <tr key={entry._id}><td>{entry.name}</td><td>{entry.email}</td><td><span className={entry.role === 'admin' ? 'admin-role is-admin' : 'admin-role'}>{entry.role}</span></td><td><span className={entry.isActive ? 'account-status active' : 'account-status blocked'}>{entry.isActive ? 'Active' : 'Blocked'}</span></td><td>{new Date(entry.createdAt).toLocaleDateString()}</td><td><div className="user-actions"><button disabled={adminBusy || entry._id === user?.id} onClick={() => setAccountActive(entry, !entry.isActive)}>{entry.isActive ? 'Block' : 'Unblock'}</button><button className="remove-user-button" disabled={adminBusy || entry._id === user?.id} onClick={() => removeAccount(entry)}>Remove</button></div></td></tr>)}</tbody></table>{!adminUsers.length && <div className="admin-empty">No user accounts yet.</div>}</div>
    }
    if (adminTab === 'logs') {
      return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Email</th><th>Event</th><th>Time</th></tr></thead><tbody>{adminLogs.map((entry) => <tr key={entry._id}><td>{entry.email}</td><td><span className={`event-pill event-${entry.action}`}>{entry.action.replace('_', ' ')}</span></td><td>{new Date(entry.createdAt).toLocaleString()}</td></tr>)}</tbody></table>{!adminLogs.length && <div className="admin-empty">No sign-in activity yet.</div>}</div>
    }
    if (adminTab === 'published') {
      return <div className="admin-recipe-list">{publishedRecipes.map((recipe) => <article className="admin-recipe-card" key={recipe._id}>
        {editingRecipeId === recipe._id ? <form className="admin-recipe-edit" onSubmit={(event) => saveRecipeEdits(event, recipe)}>
          <h3>Edit published recipe</h3>
          {editingRecipePhotoPreview || recipe.image ? <img className="admin-recipe-preview" src={editingRecipePhotoPreview || recipeImageUrl(recipe.image, 700)} alt={`Preview of ${recipe.name}`} /> : <div className="admin-recipe-preview admin-recipe-no-photo">No photo provided</div>}
          <label>Recipe photo<input type="file" name="adminRecipePhoto" accept="image/png,image/jpeg,image/webp" onChange={(event) => chooseRecipePhoto(event, setEditingRecipePhotoPreview, setEditingRecipeError)} /><span className="field-hint">PNG, JPEG, or WebP, up to 4 MB. Leave empty to keep the current photo.</span></label>
          <label>Recipe name<input name="adminRecipeName" defaultValue={recipe.name} minLength="3" maxLength="100" required /></label>
          <div className="submit-recipe-row"><label>Category<select name="adminRecipeCategory" defaultValue={recipe.category}><option>Breakfast</option><option>Lunch</option><option>Dinner</option></select></label><label>Prep time<input name="adminRecipeTime" type="number" min="1" max="600" defaultValue={recipe.time} required /></label></div>
          <label>Description<textarea name="adminRecipeDescription" defaultValue={recipe.description} minLength="10" maxLength="600" rows="3" required /></label>
          <label>Ingredients <span className="field-hint">One per line</span><textarea name="adminRecipeIngredients" defaultValue={recipe.ingredients.join('\n')} rows="5" required /></label>
          {editingRecipeError && <p className="auth-error" role="alert">{editingRecipeError}</p>}
          <div className="review-actions"><button type="button" onClick={() => { setEditingRecipeId(null); setEditingRecipePhotoPreview(''); setEditingRecipeError('') }}>Cancel</button><button className="approve-recipe" type="submit" disabled={adminBusy}>{adminBusy ? 'Saving…' : 'Save edits'}</button></div>
        </form> : <>
          {recipe.image ? <img className="admin-recipe-preview" src={recipeImageUrl(recipe.image, 700)} alt={`Photo for ${recipe.name}`} /> : <div className="admin-recipe-preview admin-recipe-no-photo">No photo provided</div>}
          <div className="admin-recipe-top"><div><span className="pending-label">PUBLISHED</span><h3>{recipe.name}</h3></div><span className="admin-recipe-meta">{recipe.category} · {recipe.time} min</span></div>
          <p className="admin-recipe-description">{recipe.description}</p><p className="admin-recipe-author">Submitted by {recipe.submittedBy?.name || 'User'} · {recipe.submittedBy?.email || 'unknown'}</p>
          <div className="review-actions"><button onClick={() => { setEditingRecipeId(recipe._id); setEditingRecipePhotoPreview(''); setEditingRecipeError('') }}>Edit</button><button className="reject-recipe" disabled={adminBusy} onClick={() => removeRecipe(recipe)}>Remove from Savor</button></div>
        </>}
      </article>)}{!publishedRecipes.length && <div className="admin-empty">No published community recipes.</div>}</div>
    }
    return <div className="admin-recipe-list">{pendingRecipes.map((recipe) => (
      <article className="admin-recipe-card" key={recipe._id}>
        {editingRecipeId === recipe._id ? <form className="admin-recipe-edit" onSubmit={(event) => saveRecipeEdits(event, recipe)}>
          <h3>Edit recipe before review</h3>
          {editingRecipePhotoPreview || recipe.image ? <img className="admin-recipe-preview" src={editingRecipePhotoPreview || recipeImageUrl(recipe.image, 700)} alt={`Preview of ${recipe.name}`} /> : <div className="admin-recipe-preview admin-recipe-no-photo">No photo provided</div>}
          <label>Recipe photo<input type="file" name="adminRecipePhoto" accept="image/png,image/jpeg,image/webp" onChange={(event) => chooseRecipePhoto(event, setEditingRecipePhotoPreview, setEditingRecipeError)} /><span className="field-hint">PNG, JPEG, or WebP, up to 4 MB. Leave empty to keep the current photo.</span></label>
          <label>Recipe name<input name="adminRecipeName" defaultValue={recipe.name} minLength="3" maxLength="100" required /></label>
          <div className="submit-recipe-row"><label>Category<select name="adminRecipeCategory" defaultValue={recipe.category}><option>Breakfast</option><option>Lunch</option><option>Dinner</option></select></label><label>Prep time<input name="adminRecipeTime" type="number" min="1" max="600" defaultValue={recipe.time} required /></label></div>
          <label>Description<textarea name="adminRecipeDescription" defaultValue={recipe.description} minLength="10" maxLength="600" rows="3" required /></label>
          <label>Ingredients <span className="field-hint">One per line</span><textarea name="adminRecipeIngredients" defaultValue={recipe.ingredients.join('\n')} rows="5" required /></label>
          {editingRecipeError && <p className="auth-error" role="alert">{editingRecipeError}</p>}
          <div className="review-actions"><button type="button" onClick={() => { setEditingRecipeId(null); setEditingRecipePhotoPreview(''); setEditingRecipeError('') }}>Cancel</button><button className="approve-recipe" type="submit" disabled={adminBusy}>{adminBusy ? 'Saving…' : 'Save edits'}</button></div>
        </form> : <>
          {recipe.image ? <img className="admin-recipe-preview" src={recipeImageUrl(recipe.image, 700)} alt={`Submitted photo for ${recipe.name}`} /> : <div className="admin-recipe-preview admin-recipe-no-photo">No photo provided</div>}
          <div className="admin-recipe-top"><div><span className="pending-label">AWAITING REVIEW</span><h3>{recipe.name}</h3></div><span className="admin-recipe-meta">{recipe.category} · {recipe.time} min</span></div>
          <p className="admin-recipe-description">{recipe.description}</p>
          <p className="admin-recipe-author">Submitted by {recipe.submittedBy?.name || 'User'} · {recipe.submittedBy?.email || 'unknown'} · {new Date(recipe.createdAt).toLocaleString()}</p>
          <h4>Ingredients</h4><ul>{recipe.ingredients.map((ingredient, index) => <li key={`${recipe._id}-${index}`}>{ingredient}</li>)}</ul>
          <div className="review-actions"><button onClick={() => { setEditingRecipeId(recipe._id); setEditingRecipePhotoPreview(''); setEditingRecipeError('') }}>Modify</button><button className="reject-recipe" disabled={adminBusy} onClick={() => reviewRecipe(recipe._id, 'rejected')}>Reject</button><button className="approve-recipe" disabled={adminBusy} onClick={() => reviewRecipe(recipe._id, 'approved')}>Approve recipe</button></div>
        </>}
      </article>
    ))}{!pendingRecipes.length && <div className="admin-empty">No pending submissions. Approved recipes are in Published recipes.<button onClick={() => setAdminTab('published')}>View published recipes</button></div>}</div>
  }

  // Recipe list filtering and saved state
  const filteredRecipes = useMemo(() => recipes.filter((recipe) => {
    const matchesCategory = category === 'All recipes' || recipe.category === category
    const matchesQuery = `${recipe.name} ${recipe.category} ${recipe.tags.join(' ')} ${recipe.ingredients.join(' ')}`.toLowerCase().includes(query.toLowerCase())
    const matchesSaved = !showSaved || saved.includes(recipe.id)
    return matchesCategory && matchesQuery && matchesSaved
  }), [category, query, recipes, saved, showSaved])

  const toggleSaved = (id) => setSaved((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])

  // Page layout
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Savor home"><span className="brand-mark">s.</span><span>savor<span className="brand-dot">.</span></span></a>
        <nav className="topnav" aria-label="Main navigation"><a className={!showSaved ? 'nav-active' : ''} href="#recipes" onClick={() => setShowSaved(false)}>Discover</a><button className={showSaved ? 'nav-button nav-active' : 'nav-button'} onClick={() => setShowSaved(!showSaved)} aria-pressed={showSaved}>Favorites <span className="saved-count">{saved.length}</span></button></nav>
        <div className="account-actions">{user ? <>{user.role === 'admin' && <button className="admin-open-button" onClick={openAdminPanel}>Admin</button>}<span className="user-greeting">Hi, {user.name.split(' ')[0]}</span><button className="account-button" onClick={signOut}>Sign out</button></> : <button className="account-button" onClick={() => { setAuthError(''); setAuthMode('login') }}>Log in <span>·</span> Sign up</button>}</div>
      </header>

      <main id="home">
        <section className="intro">
          <div className="eyebrow"><span className="eyebrow-line" /> YOUR NEXT FAVORITE MEAL</div>
          <h1>Find something<br /><em>delicious.</em></h1>
          <p className="intro-copy">A little inspiration for whatever’s in your fridge, on your mind, or around your table.</p>
          <form className="searchbar" onSubmit={(event) => event.preventDefault()}>
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input aria-label="Search recipes" placeholder="Search recipes, ingredients..." value={query} onChange={(event) => setQuery(event.target.value)} />
            {query && <button className="clear-search" type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
            <button className="search-submit" type="submit">Find recipes <span>→</span></button>
          </form>
          <div className="popular-searches"><span>POPULAR:</span>{['Pasta', 'Quick & easy', 'Vegetarian'].map((term) => <button key={term} onClick={() => setQuery(term === 'Quick & easy' ? 'Quick' : term)}>{term}</button>)}</div>
        </section>

        <section className="recipe-section" id="recipes">
          <div className="section-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> THE GOOD STUFF</div><h2>{showSaved ? 'Your favorite dishes' : 'Recipes to fall for'}</h2></div><div className="recipe-section-actions"><button className="add-recipe-button" onClick={openRecipeSubmission}><span>＋</span> Add a recipe</button>{user?.role === 'admin' && <button className="home-review-button" onClick={openAdminPanel}>Review submissions</button>}<span className="recipe-count">{filteredRecipes.length.toString().padStart(2, '0')} RECIPES</span></div></div>
          {recipeSubmissionNotice && <p className="recipe-notice" role="status">{recipeSubmissionNotice}</p>}
          <div className="filter-row"><div className="category-tabs" role="tablist" aria-label="Filter recipes">{categories.map((item) => <button key={item} role="tab" aria-selected={category === item} className={category === item ? 'category-tab active' : 'category-tab'} onClick={() => setCategory(item)}>{item}</button>)}</div><span className="sort-note">Fresh ideas, picked for you <span>✳</span></span></div>
          {recipeLoading ? <div className="empty-state"><p>Loading recipes…</p></div> : filteredRecipes.length ? <div className="recipe-grid">{filteredRecipes.map((recipe, index) => <article className="recipe-card" key={recipe.id} style={{ '--card-index': index }}>
            <button className="recipe-image-button" onClick={() => setSelected(recipe)} aria-label={`View ${recipe.name}`}>{recipe.image ? <img className="recipe-image" src={recipeImageUrl(recipe.image)} alt={recipe.name} /> : <span className="recipe-photo-empty" aria-label="No photo provided" />}<span className="image-category">{recipe.category}</span></button>
            <button className={saved.includes(recipe.id) ? 'save-button is-saved' : 'save-button'} onClick={() => toggleSaved(recipe.id)} aria-label={saved.includes(recipe.id) ? 'Remove from saved' : 'Save recipe'}>{saved.includes(recipe.id) ? '♥' : '♡'}</button>
            <div className="recipe-info"><div className="recipe-meta"><span>✦ {recipe.rating}</span><span>{recipe.time} MIN</span></div><button className="recipe-title" onClick={() => setSelected(recipe)}>{recipe.name}<span>↗</span></button><p className="recipe-description">{recipe.description}</p><div className="recipe-tags">{recipe.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div>
          </article>)}</div> : <div className="empty-state"><span>✳</span><h3>{showSaved ? 'No favorite dishes yet.' : 'No recipes found just yet.'}</h3><p>{showSaved ? 'Tap the heart on a recipe to add it to your favorites.' : 'Have a recipe in mind? Share it with the Savor community.'}</p><div className="empty-actions">{!showSaved && <button onClick={openRecipeSubmission}>Submit a recipe</button>}<button className="secondary-action" onClick={() => { setQuery(''); setCategory('All recipes'); setShowSaved(false) }}>{showSaved ? 'Browse all recipes' : 'Show all recipes'}</button></div></div>}
        </section>

        <section className="newsletter"><div><span className="eyebrow"><span className="eyebrow-line" /> A LITTLE SOMETHING GOOD</span><h2>Good food, in your inbox.</h2><p>Save your email to the Savor recipe updates list.</p>{newsletterMessage && <p className="newsletter-feedback" role="status">{newsletterMessage}</p>}{newsletterError && <p className="newsletter-feedback newsletter-feedback-error" role="alert">{newsletterError}</p>}</div><form className="newsletter-form" onSubmit={subscribeToNewsletter}><input aria-label="Email address" type="email" placeholder="Your email address" value={newsletterEmail} onChange={(event) => setNewsletterEmail(event.target.value)} required disabled={newsletterBusy} /><button type="submit" disabled={newsletterBusy}>{newsletterBusy ? 'Saving…' : 'Count me in'} <span>→</span></button></form></section>
      </main>
      <footer className="footer"><a className="brand" href="#home"><span className="brand-mark">s.</span><span>savor<span className="brand-dot">.</span></span></a><span>Made with care, and a pinch of salt.</span><span>© 2025 Savor Kitchen</span></footer>

      {/* Overlays */}
      {selected && <div className="modal-backdrop" role="presentation" onClick={() => setSelected(null)}><section className="recipe-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setSelected(null)} aria-label="Close recipe">×</button>{selected.image ? <img src={recipeImageUrl(selected.image, 1200, 'clip')} alt={selected.name} /> : <div className="recipe-modal-empty-photo" aria-label="No photo provided" />}<div className="modal-content"><span className="eyebrow"><span className="eyebrow-line" /> {selected.category.toUpperCase()} · {selected.time} MIN</span><h2 id="modal-title">{selected.name}</h2><p>{selected.description}</p><h3>What you’ll need</h3><ul>{selected.ingredients.map((ingredient) => <li key={ingredient}>{ingredient}</li>)}</ul><button className="modal-save" onClick={() => toggleSaved(selected.id)}>{saved.includes(selected.id) ? '♥ Saved to your recipes' : '♡ Save this recipe'}</button></div></section></div>}

      {adminPanel && <div className="modal-backdrop admin-backdrop" role="presentation" onClick={() => setAdminPanel(false)}>
        <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title" onClick={(event) => event.stopPropagation()}>
          <button className="modal-close" onClick={() => setAdminPanel(false)} aria-label="Close admin dashboard">×</button>
          <div className="admin-header"><span className="eyebrow"><span className="eyebrow-line" /> SAVOR ADMINISTRATION</span><h2 id="admin-title">Control room.</h2><p>Review submitted recipes, registered accounts, and sign-in activity.</p></div>
          <div className="admin-summary"><div><strong>{adminUsers.length}</strong><span>USER ACCOUNTS</span></div><div><strong>{adminLogs.length}</strong><span>RECENT EVENTS</span></div><div><strong>{pendingRecipes.length}</strong><span>RECIPES TO REVIEW</span></div><button onClick={loadAdminData} disabled={adminBusy}>{adminBusy ? 'Refreshing…' : '↻ Refresh'}</button></div>
          <div className="admin-tabs"><button className={adminTab === 'recipes' ? 'active' : ''} onClick={() => setAdminTab('recipes')}>Recipe review {pendingRecipes.length > 0 && <span className="pending-count">{pendingRecipes.length}</span>}</button><button className={adminTab === 'published' ? 'active' : ''} onClick={() => setAdminTab('published')}>Published recipes</button><button className={adminTab === 'users' ? 'active' : ''} onClick={() => setAdminTab('users')}>Users</button><button className={adminTab === 'logs' ? 'active' : ''} onClick={() => setAdminTab('logs')}>Sign-in activity</button></div>
          {renderAdminContent()}<p className="admin-note">Use Block to suspend access. Remove permanently deletes the account, its recipes, and its activity history.</p>
        </section>
      </div>}

      {notificationsOpen && notifications.length > 0 && <div className="modal-backdrop notification-backdrop" role="presentation" onClick={dismissNotifications}><section className="notification-modal" role="dialog" aria-modal="true" aria-labelledby="notification-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={dismissNotifications} aria-label="Close notifications">×</button><span className="eyebrow"><span className="eyebrow-line" /> RECIPE UPDATE</span><h2 id="notification-title">There’s news about your recipe.</h2><div className="notification-list">{notifications.map((item) => <article className="notification-item" key={item._id}><span className={`notification-status status-${item.type}`}>{item.type === 'modified' ? 'Modified' : item.type === 'approved' ? 'Approved' : item.type === 'rejected' ? 'Not approved' : 'Removed'}</span><h3>{item.recipeName}</h3><p>{item.message}</p><time>{new Date(item.createdAt).toLocaleString()}</time></article>)}</div><button className="auth-submit notification-dismiss" onClick={dismissNotifications}>Got it</button></section></div>}

      {recipeSubmissionOpen && <div className="modal-backdrop submit-recipe-backdrop" role="presentation" onClick={() => setRecipeSubmissionOpen(false)}><section className="submit-recipe-modal" role="dialog" aria-modal="true" aria-labelledby="submit-recipe-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setRecipeSubmissionOpen(false)} aria-label="Close recipe form">×</button><span className="eyebrow"><span className="eyebrow-line" /> COMMUNITY RECIPE</span><h2 id="submit-recipe-title">Share what you love.</h2><p>Your recipe will be reviewed by the Savor team before it appears in search.</p><form className="submit-recipe-form" onSubmit={submitRecipe}><label>Recipe name<input name="recipeName" minLength="3" maxLength="100" placeholder="e.g. Sunday tomato pasta" required /></label><div className="submit-recipe-row"><label>Meal category<select name="recipeCategory" defaultValue="Dinner"><option>Breakfast</option><option>Lunch</option><option>Dinner</option></select></label><label>Prep time (minutes)<input name="recipeTime" type="number" min="1" max="600" defaultValue="30" required /></label></div><label>Recipe photo <span className="field-hint">Optional · PNG, JPEG, or WebP, up to 4 MB</span><input name="recipePhoto" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => chooseRecipePhoto(event, setRecipePhotoPreview, setRecipeSubmissionError)} /></label>{recipePhotoPreview && <img className="recipe-photo-preview" src={recipePhotoPreview} alt="Selected recipe preview" />}<label>Short description<textarea name="recipeDescription" minLength="10" maxLength="600" rows="3" placeholder="What makes this recipe special?" required /></label><label>Ingredients <span className="field-hint">One ingredient per line (at least 2)</span><textarea name="recipeIngredients" rows="5" placeholder={'2 cups pasta\n1 tbsp olive oil'} required /></label>{recipeSubmissionError && <p className="auth-error" role="alert">{recipeSubmissionError}</p>}<button className="auth-submit" type="submit" disabled={recipeSubmissionBusy}>{recipeSubmissionBusy ? 'Submitting…' : 'Send for review'} <span>→</span></button></form></section></div>}

      {authMode && <div className="modal-backdrop auth-backdrop" role="presentation" onClick={() => setAuthMode(null)}><section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setAuthMode(null)} aria-label="Close">×</button><div className="auth-brand"><span className="brand-mark">s.</span></div><span className="eyebrow"><span className="eyebrow-line" /> A PLACE AT OUR TABLE</span><h2 id="auth-title">{authMode === 'signup' ? 'Join the table.' : 'Welcome back.'}</h2><p className="auth-subtitle">{authMode === 'signup' ? 'Save the recipes you love and find your next favorite.' : 'Sign in to find your saved recipes.'}</p><form className="auth-form" onSubmit={submitAuth}>{authMode === 'signup' && <label>Your name<input name="name" type="text" autoComplete="name" placeholder="Jamie Cook" minLength="2" required /></label>}<label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></label><div className="password-field"><label htmlFor="auth-password">Password</label><div className="password-input-wrap"><input id="auth-password" name="password" type={passwordVisible ? 'text' : 'password'} autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} placeholder={authMode === 'signup' ? 'Create a strong password' : 'Your password'} minLength={authMode === 'signup' ? 8 : undefined} required /><button className="password-toggle" type="button" onClick={() => setPasswordVisible(!passwordVisible)} aria-label={passwordVisible ? 'Hide password' : 'Show password'}>{passwordVisible ? 'Hide' : 'Show'}</button></div>{authMode === 'signup' && <span className="password-hint">At least 8 characters, with a letter, a number, and a symbol.</span>}</div>{authError && <p className="auth-error" role="alert">{authError}</p>}<button className="auth-submit" type="submit" disabled={authBusy}>{authBusy ? 'One moment…' : authMode === 'signup' ? 'Create your account' : 'Log in'} <span>→</span></button></form><p className="auth-switch">{authMode === 'signup' ? 'Already have an account?' : 'New to Savor?'} <button onClick={() => { setAuthMode(authMode === 'signup' ? 'login' : 'signup'); setAuthError(''); setPasswordVisible(false) }}>{authMode === 'signup' ? 'Log in' : 'Create an account'}</button></p><p className="auth-terms">By continuing, you agree to keep good food close.</p></section></div>}
    </div>
  )
}

export default App
